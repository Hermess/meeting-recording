import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  CreateMeetingInputSchema,
  MeetingStatusSchema,
  UpdateMeetingInputSchema
} from "@meeting-ai-kit/shared";
import { prisma } from "../prisma.js";
import { requireAuthContext, scopedMeetingWhere } from "../services/auth.js";
import { sendNotFound, sendZodError } from "../utils/http.js";
import { getStorageRoot, resolveStoragePath } from "../utils/paths.js";

const ListMeetingsQuerySchema = z.object({
  projectName: z.string().optional(),
  meetingType: z.string().optional(),
  status: MeetingStatusSchema.optional()
});

const MeetingParamsSchema = z.object({
  id: z.string().min(1)
});

const MergeRecordingsBodySchema = z.object({
  sessionId: z.string().trim().min(1).optional()
});

export async function registerMeetingRoutes(app: FastifyInstance) {
  app.get("/meetings", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) {
      return;
    }
    const parsed = ListMeetingsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendZodError(reply, parsed.error);
    }

    const where: Prisma.MeetingWhereInput = scopedMeetingWhere(auth);
    if (parsed.data.projectName) {
      where.projectName = { contains: parsed.data.projectName, mode: "insensitive" };
    }
    if (parsed.data.meetingType) {
      where.meetingType = parsed.data.meetingType;
    }
    if (parsed.data.status) {
      where.status = parsed.data.status;
    }

    const meetings = await prisma.meeting.findMany({
      where,
      include: {
        _count: {
          select: {
            actionItems: true,
            recordingAssets: true,
            transcriptSegments: true,
            visualReports: true
          }
        }
      },
      orderBy: {
        updatedAt: "desc"
      }
    });

    return {
      data: meetings.map(serializeMeetingWithCounts)
    };
  });

  app.post("/meetings", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) {
      return;
    }
    const parsed = CreateMeetingInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendZodError(reply, parsed.error);
    }

    const now = new Date();
    const defaultModel = await prisma.modelConfig.findFirst({
      where: {
        ...(auth.enabled && auth.user ? { ownerUserId: auth.user.id } : {}),
        enabled: true
      },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
    });
    const summaryModelConfigId = parsed.data.summaryModelConfigId ?? defaultModel?.id;
    if (!summaryModelConfigId) {
      return reply.code(400).send({
        error: "missing_default_model",
        message: "请先在设置页新增并测试通过一个模型网关配置，然后设为默认纪要模型。"
      });
    }
    const visualTemplateId = parsed.data.visualTemplateId;
    const feishuFolder = parsed.data.feishuFolder || null;
    const initialStatus = parsed.data.startNow
      ? parsed.data.inputMode === "record"
        ? "recording"
        : "recorded"
      : "draft";
    const meeting = await prisma.meeting.create({
      data: {
        ownerUserId: auth.enabled && auth.user ? auth.user.id : null,
        title: parsed.data.title,
        meetingType: parsed.data.meetingType,
        inputMode: parsed.data.inputMode,
        projectName: parsed.data.projectName || null,
        startTime: parsed.data.startNow ? now : null,
        status: initialStatus,
        participants: parsed.data.participants,
        summaryModelConfigId,
        visualTemplateId,
        feishuFolder,
        yuqueRepoNamespace: parsed.data.yuqueRepoNamespace || null,
        yuquePublicLevel: parsed.data.yuquePublicLevel ?? null
      }
    });

    return reply.code(201).send({ data: serializeMeeting(meeting) });
  });

  app.get("/meetings/:id", async (request, reply) => {
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
      include: {
        transcriptSegments: { orderBy: { index: "asc" } },
        recordingAssets: { orderBy: { createdAt: "asc" } },
        meetingMinutes: { orderBy: { createdAt: "desc" }, take: 1 },
        visualReports: { orderBy: { createdAt: "desc" }, take: 1 },
        actionItems: true,
        feishuPublishLogs: { orderBy: { createdAt: "desc" }, take: 5 }
      }
    });

    if (!meeting) {
      return sendNotFound(reply, "Meeting");
    }

    return { data: serializeMeeting(meeting) };
  });

  app.patch("/meetings/:id", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) {
      return;
    }
    const params = parseMeetingParams(request, reply);
    if (!params) {
      return;
    }

    const parsed = UpdateMeetingInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendZodError(reply, parsed.error);
    }

    const updateData: Prisma.MeetingUpdateInput = {};
    if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
    if (parsed.data.meetingType !== undefined) updateData.meetingType = parsed.data.meetingType;
    if (parsed.data.inputMode !== undefined) updateData.inputMode = parsed.data.inputMode;
    if (parsed.data.projectName !== undefined) updateData.projectName = parsed.data.projectName;
    if (parsed.data.startTime !== undefined) {
      updateData.startTime = parsed.data.startTime === null ? null : new Date(parsed.data.startTime);
    }
    if (parsed.data.endTime !== undefined) {
      updateData.endTime = parsed.data.endTime === null ? null : new Date(parsed.data.endTime);
    }
    if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
    if (parsed.data.participants !== undefined) updateData.participants = parsed.data.participants;
    if (parsed.data.summaryModelConfigId !== undefined) updateData.summaryModelConfigId = parsed.data.summaryModelConfigId;
    if (parsed.data.visualTemplateId !== undefined) updateData.visualTemplateId = parsed.data.visualTemplateId;
    if (parsed.data.feishuFolder !== undefined) updateData.feishuFolder = parsed.data.feishuFolder;
    if (parsed.data.feishuDocUrl !== undefined) updateData.feishuDocUrl = parsed.data.feishuDocUrl;
    if (parsed.data.yuqueRepoNamespace !== undefined) updateData.yuqueRepoNamespace = parsed.data.yuqueRepoNamespace;
    if (parsed.data.yuquePublicLevel !== undefined) updateData.yuquePublicLevel = parsed.data.yuquePublicLevel;
    if (parsed.data.yuqueDocUrl !== undefined) updateData.yuqueDocUrl = parsed.data.yuqueDocUrl;
    if (parsed.data.lastError !== undefined) updateData.lastError = parsed.data.lastError;

    const meeting = await prisma.meeting.findFirst({
      where: scopedMeetingWhere(auth, params.id),
      select: { id: true }
    });
    if (!meeting) {
      return sendNotFound(reply, "Meeting");
    }
    const updated = await prisma.meeting.update({
      where: { id: meeting.id },
      data: updateData
    });

    return { data: serializeMeeting(updated) };
  });

  app.delete("/meetings/:id", async (request, reply) => {
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
      include: {
        recordingAssets: { select: { storagePath: true } },
        visualReports: { select: { htmlPath: true, imagePath: true } }
      }
    });
    if (!meeting) {
      return sendNotFound(reply, "Meeting");
    }

    await prisma.meeting.delete({
      where: { id: meeting.id }
    });

    const cleanupWarnings = await cleanupMeetingFiles({
      meetingId: meeting.id,
      recordingPaths: meeting.recordingAssets.map((asset) => asset.storagePath),
      visualPaths: meeting.visualReports.flatMap((report) => [report.htmlPath, report.imagePath])
    });

    return {
      data: {
        id: meeting.id,
        deleted: true,
        cleanupWarnings
      }
    };
  });

  app.post("/meetings/:id/start", async (request, reply) => {
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
    const updated = await prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        status: "recording",
        startTime: new Date(),
        lastError: null
      }
    });

    return { data: serializeMeeting(updated) };
  });

  app.post("/meetings/:id/stop", async (request, reply) => {
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
    const updated = await prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        status: "recorded",
        endTime: new Date()
      }
    });

    return { data: serializeMeeting(updated) };
  });

  app.get("/meetings/:id/recordings", async (request, reply) => {
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

    const recordings = await prisma.recordingAsset.findMany({
      where: { meetingId: params.id },
      orderBy: { createdAt: "asc" }
    });
    return { data: recordings.map(serializeRecordingAsset) };
  });

  app.post("/meetings/:id/recordings/merge", async (request, reply) => {
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
    const parsedBody = MergeRecordingsBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return sendZodError(reply, parsedBody.error);
    }
    const sessionId = parsedBody.data.sessionId;

    const recordings = await prisma.recordingAsset.findMany({
      where: { meetingId: params.id },
      orderBy: { createdAt: "asc" }
    });
    const parts = recordings
      .filter((recording) => isRecordingPart(recording.filename, recording.originalName))
      .filter((recording) => !sessionId || isRecordingSessionPart(recording.filename, recording.originalName, sessionId))
      .sort(compareRecordingParts);
    if (parts.length === 0) {
      return reply.code(400).send({
        error: "no_recording_parts",
        message: "没有可合成的录音分片。"
      });
    }
    const firstPart = parts[0]!;
    const lastPart = parts[parts.length - 1]!;
    const totalPartBytes = parts.reduce((sum, part) => sum + part.sizeBytes, 0);

    const existingMerged = recordings
      .filter((recording) => isMergedRecording(recording.filename, recording.originalName))
      .filter((recording) => !sessionId || isRecordingSessionPart(recording.filename, recording.originalName, sessionId))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
    if (existingMerged && existingMerged.createdAt > lastPart.createdAt && existingMerged.sizeBytes >= totalPartBytes * 0.9) {
      return { data: serializeRecordingAsset(existingMerged), merged: true, reused: true };
    }

    const extension = getAudioExtension(firstPart.filename, firstPart.mimeType);
    const filename = `${Date.now()}-${sessionId ? `${sessionId}-` : ""}complete-recording.${extension}`;
    const storagePath = resolveStoragePath("recordings", params.id, filename);
    await mkdir(path.dirname(storagePath), { recursive: true });

    try {
      await concatenateRecordingParts(parts.map((recording) => recording.storagePath), storagePath);
    } catch (error) {
      return reply.code(500).send({
        error: "recording_merge_failed",
        message: error instanceof Error ? error.message : "录音分片合成失败。"
      });
    }

    const sizeBytes = await fileSize(storagePath);
    const created = await prisma.recordingAsset.create({
      data: {
        meetingId: params.id,
        filename,
        originalName: sessionId ? `完整录音-${sessionId}.${extension}` : `完整录音.${extension}`,
        mimeType: firstPart.mimeType,
        sizeBytes,
        storagePath,
        publicUrl: `/storage/recordings/${params.id}/${filename}`
      }
    });

    return reply.code(201).send({ data: serializeRecordingAsset(created), merged: true });
  });

  app.post("/meetings/:id/recordings", async (request, reply) => {
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
        error: "missing_recording_file",
        message: "没有收到录音文件。"
      });
    }

    const buffer = await file.toBuffer();
    if (buffer.length < 1024) {
      return reply.code(400).send({
        error: "empty_recording_file",
        message: "录音文件为空或过短。"
      });
    }

    const mimeType = normalizeAudioMimeType(file.mimetype);
    if (!mimeType) {
      return reply.code(400).send({
        error: "unsupported_recording_type",
        message: "只支持 webm、mp4、ogg、wav、mp3 等音频文件。"
      });
    }

    const extension = getAudioExtension(file.filename, mimeType);
    const safeBaseName = sanitizeFilename(path.basename(file.filename || "recording", path.extname(file.filename || ""))) || "recording";
    const filename = `${Date.now()}-${safeBaseName}.${extension}`;
    const storagePath = resolveStoragePath("recordings", params.id, filename);
    await mkdir(path.dirname(storagePath), { recursive: true });
    await writeFile(storagePath, buffer);

    const publicUrl = `/storage/recordings/${params.id}/${filename}`;
    const created = await prisma.recordingAsset.create({
      data: {
        meetingId: params.id,
        filename,
        originalName: file.filename || null,
        mimeType,
        sizeBytes: buffer.length,
        storagePath,
        publicUrl
      }
    });

    return reply.code(201).send({ data: serializeRecordingAsset(created) });
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

function serializeMeeting(meeting: Record<string, unknown>) {
  return {
    ...meeting,
    recordingAssets: Array.isArray(meeting.recordingAssets)
      ? meeting.recordingAssets.map((item) => serializeRecordingAsset(item as Record<string, unknown>))
      : meeting.recordingAssets,
    startTime: meeting.startTime instanceof Date ? meeting.startTime.toISOString() : meeting.startTime,
    endTime: meeting.endTime instanceof Date ? meeting.endTime.toISOString() : meeting.endTime,
    createdAt: meeting.createdAt instanceof Date ? meeting.createdAt.toISOString() : meeting.createdAt,
    updatedAt: meeting.updatedAt instanceof Date ? meeting.updatedAt.toISOString() : meeting.updatedAt
  };
}

function serializeMeetingWithCounts(meeting: Record<string, unknown> & { _count?: Record<string, number> }) {
  return {
    ...serializeMeeting(meeting),
    counts: {
      actionItems: meeting._count?.actionItems ?? 0,
      recordingAssets: meeting._count?.recordingAssets ?? 0,
      transcriptSegments: meeting._count?.transcriptSegments ?? 0,
      visualReports: meeting._count?.visualReports ?? 0
    },
    _count: undefined
  };
}

function serializeRecordingAsset(recording: Record<string, unknown>) {
  return {
    ...recording,
    createdAt: recording.createdAt instanceof Date ? recording.createdAt.toISOString() : recording.createdAt
  };
}

function isRecordingPart(filename: string, originalName?: string | null) {
  return filename.includes("recording-part-") || Boolean(originalName?.includes("recording-part-"));
}

function isMergedRecording(filename: string, originalName?: string | null) {
  return filename.includes("complete-recording") || Boolean(originalName?.includes("完整录音"));
}

function isRecordingSessionPart(filename: string, originalName: string | null | undefined, sessionId: string) {
  return filename.includes(sessionId) || Boolean(originalName?.includes(sessionId));
}

function compareRecordingParts(left: { filename: string; originalName?: string | null; createdAt: Date }, right: { filename: string; originalName?: string | null; createdAt: Date }) {
  const leftIndex = extractRecordingPartIndex(left.filename, left.originalName);
  const rightIndex = extractRecordingPartIndex(right.filename, right.originalName);
  if (leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }
  return left.createdAt.getTime() - right.createdAt.getTime();
}

function extractRecordingPartIndex(filename: string, originalName?: string | null) {
  const source = `${originalName ?? ""} ${filename}`;
  const match = source.match(/recording-part-(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

async function fileSize(filePath: string) {
  const { stat } = await import("node:fs/promises");
  return (await stat(filePath)).size;
}

async function concatenateRecordingParts(partPaths: string[], outputPath: string) {
  const output = createWriteStream(outputPath);
  try {
    for (const partPath of partPaths) {
      const input = createReadStream(partPath);
      for await (const chunk of input) {
        if (!output.write(chunk)) {
          await waitForDrain(output);
        }
      }
    }
    await new Promise<void>((resolve, reject) => {
      output.end(resolve);
      output.once("error", reject);
    });
  } catch (error) {
    output.destroy();
    throw error;
  }
}

function waitForDrain(output: NodeJS.WritableStream) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      output.off("drain", onDrain);
      output.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    output.once("drain", onDrain);
    output.once("error", onError);
  });
}

function normalizeAudioMimeType(mimeType: string) {
  const normalized = (mimeType.toLowerCase().split(";")[0] ?? "").trim();
  if (
    normalized === "audio/webm" ||
    normalized === "audio/mp4" ||
    normalized === "audio/ogg" ||
    normalized === "audio/wav" ||
    normalized === "audio/x-wav" ||
    normalized === "audio/mpeg" ||
    normalized === "video/webm" ||
    normalized === "video/mp4"
  ) {
    return normalized;
  }
  return "";
}

function getAudioExtension(filename: string | undefined, mimeType: string) {
  const ext = path.extname(filename || "").replace(".", "").toLowerCase();
  if (["webm", "mp4", "m4a", "ogg", "wav", "mp3"].includes(ext)) {
    return ext;
  }
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg")) return "mp3";
  return "webm";
}

function sanitizeFilename(value: string) {
  return value
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function cleanupMeetingFiles(input: {
  meetingId: string;
  recordingPaths: string[];
  visualPaths: Array<string | null>;
}) {
  const warnings: string[] = [];
  const targets = new Set<string>();

  for (const filePath of input.recordingPaths) {
    targets.add(filePath);
  }
  for (const filePath of input.visualPaths) {
    if (filePath) {
      targets.add(filePath);
    }
  }
  targets.add(resolveStoragePath("recordings", input.meetingId));

  await Promise.all(
    [...targets].map(async (target) => {
      const safePath = safeStoragePath(target);
      if (!safePath) {
        warnings.push(`跳过非 storage 路径：${target}`);
        return;
      }
      try {
        await rm(safePath, { recursive: true, force: true });
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : `删除文件失败：${target}`);
      }
    })
  );

  return warnings;
}

function safeStoragePath(value: string) {
  const storageRoot = path.resolve(getStorageRoot());
  const target = path.resolve(value);
  if (target === storageRoot || !target.startsWith(`${storageRoot}${path.sep}`)) {
    return null;
  }
  return target;
}
