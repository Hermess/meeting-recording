import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  CreateTranscriptSegmentsInputSchema,
  UpdateTranscriptSegmentInputSchema
} from "@meeting-ai-kit/shared";
import { prisma } from "../prisma.js";
import { requireAuthContext, scopedMeetingWhere } from "../services/auth.js";
import { extractTranscriptFromUpload } from "../services/document-parser.js";
import { sendNotFound, sendZodError } from "../utils/http.js";

const MeetingParamsSchema = z.object({
  id: z.string().min(1)
});

const SegmentParamsSchema = z.object({
  id: z.string().min(1),
  segmentId: z.string().min(1)
});

export async function registerTranscriptRoutes(app: FastifyInstance) {
  app.get("/meetings/:id/transcript-segments", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) {
      return;
    }
    const params = parseMeetingParams(request, reply);
    if (!params) {
      return;
    }

    const meeting = await prisma.meeting.findFirst({
      where: scopedMeetingWhere(auth, params.id),
      select: { id: true }
    });
    if (!meeting) {
      return sendNotFound(reply, "Meeting");
    }

    const segments = await prisma.transcriptSegment.findMany({
      where: { meetingId: meeting.id },
      orderBy: { index: "asc" }
    });

    return { data: segments.map(serializeTranscriptSegment) };
  });

  app.post("/meetings/:id/transcript-segments", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) {
      return;
    }
    const params = parseMeetingParams(request, reply);
    if (!params) {
      return;
    }

    const meeting = await prisma.meeting.findFirst({
      where: scopedMeetingWhere(auth, params.id),
      select: { id: true, status: true }
    });

    if (!meeting) {
      return sendNotFound(reply, "Meeting");
    }

    const parsed = CreateTranscriptSegmentsInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendZodError(reply, parsed.error);
    }

    const latest = await prisma.transcriptSegment.findFirst({
      where: { meetingId: meeting.id },
      orderBy: { index: "desc" },
      select: { index: true }
    });
    const startIndex = (latest?.index ?? -1) + 1;
    const inputSegments =
      parsed.data.provider === "manual_paste"
        ? splitManualTranscript(parsed.data.text).map((text) => ({
            text,
            isFinal: true,
            provider: "manual_paste" as const
          }))
        : parsed.data.segments.map((segment) => ({
            ...segment,
            provider: parsed.data.provider
          }));

    if (inputSegments.length === 0) {
      return reply.code(400).send({
        error: "empty_transcript",
        message: "No transcript segment can be created from the input."
      });
    }

    const created = await prisma.$transaction(
      inputSegments.map((segment, offset) => {
        const data: Prisma.TranscriptSegmentUncheckedCreateInput = {
          meetingId: meeting.id,
          index: startIndex + offset,
          text: segment.text,
          isFinal: segment.isFinal,
          provider: segment.provider
        };
        if ("speaker" in segment && segment.speaker !== undefined) data.speaker = segment.speaker;
        if ("startMs" in segment && segment.startMs !== undefined) data.startMs = segment.startMs;
        if ("endMs" in segment && segment.endMs !== undefined) data.endMs = segment.endMs;
        if ("rawPayload" in segment && segment.rawPayload !== undefined) {
          data.rawPayload = JSON.parse(JSON.stringify(segment.rawPayload)) as Prisma.InputJsonValue;
        }

        return prisma.transcriptSegment.create({ data });
      })
    );

    return reply.code(201).send({ data: created.map(serializeTranscriptSegment) });
  });

  app.post("/meetings/:id/transcript-upload", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) {
      return;
    }
    const params = parseMeetingParams(request, reply);
    if (!params) {
      return;
    }

    const meeting = await prisma.meeting.findFirst({
      where: scopedMeetingWhere(auth, params.id),
      select: { id: true }
    });

    if (!meeting) {
      return sendNotFound(reply, "Meeting");
    }

    const file = await request.file();
    if (!file) {
      return reply.code(400).send({
        error: "missing_file",
        message: "请先选择 md、doc、docx 或 pdf 文件。"
      });
    }

    const buffer = await file.toBuffer();
    const text = await extractTranscriptFromUpload({
      filename: file.filename,
      mimeType: file.mimetype,
      buffer
    });
    if (!text.trim()) {
      return reply.code(400).send({
        error: "empty_file_text",
        message: "文件中没有提取到可用文本。"
      });
    }

    const latest = await prisma.transcriptSegment.findFirst({
      where: { meetingId: meeting.id },
      orderBy: { index: "desc" },
      select: { index: true }
    });
    const startIndex = (latest?.index ?? -1) + 1;
    const inputSegments = splitManualTranscript(text).map((item) => ({
      text: item,
      isFinal: true,
      provider: "manual_paste"
    }));

    const created = await prisma.$transaction(
      inputSegments.map((segment, offset) =>
        prisma.transcriptSegment.create({
          data: {
            meetingId: meeting.id,
            index: startIndex + offset,
            text: segment.text,
            isFinal: segment.isFinal,
            provider: segment.provider,
            rawPayload: {
              source: "file_upload",
              filename: file.filename,
              mimetype: file.mimetype
            }
          }
        })
      )
    );

    return reply.code(201).send({
      data: created.map(serializeTranscriptSegment),
      filename: file.filename
    });
  });

  app.patch("/meetings/:id/transcript-segments/:segmentId", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) {
      return;
    }
    const params = parseSegmentParams(request, reply);
    if (!params) {
      return;
    }

    const parsed = UpdateTranscriptSegmentInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendZodError(reply, parsed.error);
    }

    const updateData: Prisma.TranscriptSegmentUpdateInput = {};
    if (parsed.data.speaker !== undefined) updateData.speaker = parsed.data.speaker;
    if (parsed.data.startMs !== undefined) updateData.startMs = parsed.data.startMs;
    if (parsed.data.endMs !== undefined) updateData.endMs = parsed.data.endMs;
    if (parsed.data.text !== undefined) updateData.text = parsed.data.text;
    if (parsed.data.isFinal !== undefined) updateData.isFinal = parsed.data.isFinal;

    const meeting = await prisma.meeting.findFirst({
      where: scopedMeetingWhere(auth, params.id),
      select: { id: true }
    });
    if (!meeting) {
      return sendNotFound(reply, "Meeting");
    }
    const segment = await prisma.transcriptSegment.findFirst({
      where: { id: params.segmentId, meetingId: meeting.id },
      select: { id: true }
    });
    if (!segment) {
      return sendNotFound(reply, "Transcript segment");
    }
    const updated = await prisma.transcriptSegment.update({
      where: { id: segment.id },
      data: updateData
    });

    return { data: serializeTranscriptSegment(updated) };
  });
}

function parseMeetingParams(request: FastifyRequest, reply: FastifyReply) {
  const parsed = MeetingParamsSchema.safeParse(request.params);
  if (!parsed.success) {
    sendZodError(reply, parsed.error);
    return null;
  }

  return parsed.data;
}

function parseSegmentParams(request: FastifyRequest, reply: FastifyReply) {
  const parsed = SegmentParamsSchema.safeParse(request.params);
  if (!parsed.success) {
    sendZodError(reply, parsed.error);
    return null;
  }

  return parsed.data;
}

function splitManualTranscript(text: string) {
  const paragraphSegments = text
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (paragraphSegments.length > 1) {
    return paragraphSegments;
  }

  return text
    .split(/(?<=[。！？!?])\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function serializeTranscriptSegment(segment: Record<string, unknown>) {
  return {
    ...segment,
    createdAt: segment.createdAt instanceof Date ? segment.createdAt.toISOString() : segment.createdAt,
    updatedAt: segment.updatedAt instanceof Date ? segment.updatedAt.toISOString() : segment.updatedAt
  };
}
