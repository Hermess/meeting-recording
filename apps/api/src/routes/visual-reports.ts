import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readFile } from "node:fs/promises";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { PROJECT_BIWEEKLY_TEMPLATE } from "@meeting-ai-kit/visual-renderer";
import type { MeetingMinutesJson } from "@meeting-ai-kit/shared";
import { prisma } from "../prisma.js";
import { requireAuthContext, scopedMeetingWhere } from "../services/auth.js";
import { MARKDOWN_UNSYNCED_MESSAGE } from "../services/minutes-state.js";
import { auditMinutesQuality, buildMinutesQualityError } from "../services/minutes-quality.js";
import { renderVisualReportScreenshot } from "../services/visual-report.js";
import { sendNotFound, sendZodError } from "../utils/http.js";

const MeetingParamsSchema = z.object({
  id: z.string().min(1)
});

export async function registerVisualReportRoutes(app: FastifyInstance) {
  app.post("/meetings/:id/render-visual", async (request, reply) => {
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
        meetingMinutes: { orderBy: { createdAt: "desc" }, take: 1 },
        transcriptSegments: { orderBy: { index: "asc" } }
      }
    });

    if (!meeting) {
      return sendNotFound(reply, "Meeting");
    }

    const minutes = meeting.meetingMinutes[0];
    if (!minutes) {
      return reply.code(400).send({
        error: "missing_minutes",
        message: "请先生成结构化纪要，再生成总结长图。"
      });
    }

    if (meeting.lastError === MARKDOWN_UNSYNCED_MESSAGE) {
      return reply.code(409).send({
        error: "markdown_needs_sync",
        message: MARKDOWN_UNSYNCED_MESSAGE
      });
    }

    const minutesJson = minutes.structuredJson as unknown as MeetingMinutesJson;
    const rawTranscript = meeting.transcriptSegments.map((segment) => segment.text).join("\n");
    const audit = auditMinutesQuality({
      minutes: minutesJson,
      modelConfigId: minutes.modelConfigId,
      rawTranscript
    });
    if (!audit.approved) {
      const message = buildMinutesQualityError(audit);
      await prisma.meeting.update({
        where: { id: params.id },
        data: { lastError: message }
      });
      return reply.code(422).send({
        error: "minutes_quality_audit_failed",
        message,
        audit
      });
    }

    await prisma.meeting.update({
      where: { id: params.id },
      data: { status: "rendering", lastError: null }
    });

    try {
      const screenshot = await renderVisualReportScreenshot({
        meetingId: meeting.id,
        templateId: meeting.visualTemplateId,
        width: PROJECT_BIWEEKLY_TEMPLATE.width,
        scale: PROJECT_BIWEEKLY_TEMPLATE.scale,
        structuredJson: minutesJson
      });

      const visualReport = await prisma.$transaction(async (tx) => {
        const created = await tx.visualReport.create({
          data: {
            meetingId: meeting.id,
            templateId: meeting.visualTemplateId,
            visualJson: minutes.structuredJson as Prisma.InputJsonValue,
            htmlPath: screenshot.renderUrl,
            imagePath: screenshot.imagePath,
            imageUrl: screenshot.imageUrl,
            width: PROJECT_BIWEEKLY_TEMPLATE.width,
            scale: PROJECT_BIWEEKLY_TEMPLATE.scale
          }
        });

        await tx.meeting.update({
          where: { id: meeting.id },
          data: { status: "ready_to_publish", lastError: null }
        });

        return created;
      });

      return { data: serializeVisualReport(visualReport) };
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "长图渲染失败";
      const message = normalizeVisualRenderError(rawMessage);
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: {
          status: "generated",
          lastError: message
        }
      });

      return reply.code(500).send({
        error: "render_visual_failed",
        message
      });
    }
  });

  app.get("/meetings/:id/visual-report", async (request, reply) => {
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

    const visualReport = await prisma.visualReport.findFirst({
      where: { meetingId: meeting.id },
      orderBy: { createdAt: "desc" }
    });

    if (!visualReport) {
      return sendNotFound(reply, "Visual report");
    }

    return { data: serializeVisualReport(visualReport) };
  });

  app.get("/meetings/:id/visual-report/download", async (request, reply) => {
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
        visualReports: { orderBy: { createdAt: "desc" }, take: 1 }
      }
    });

    if (!meeting) {
      return sendNotFound(reply, "Meeting");
    }

    const visualReport = meeting.visualReports[0];
    if (!visualReport?.imagePath) {
      return sendNotFound(reply, "Visual report image");
    }

    const buffer = await readFile(visualReport.imagePath);
    return reply
      .header("content-type", "image/png")
      .header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${safeFileName(meeting.title)}-总结长图.png`)}`)
      .send(buffer);
  });
}

function normalizeVisualRenderError(message: string) {
  if (message.includes("Executable doesn't exist") || message.includes("browserType.launch")) {
    return "Playwright Chromium 尚未安装。请运行 pnpm exec playwright install chromium 后重试。";
  }
  if (message.includes("net::ERR_CONNECTION_REFUSED") || message.includes("ECONNREFUSED")) {
    return "无法访问长图渲染页。请确认 Web 服务已在 VISUAL_REPORT_BASE_URL 启动。";
  }
  return message;
}

function parseMeetingParams(request: FastifyRequest, reply: FastifyReply) {
  const parsed = MeetingParamsSchema.safeParse(request.params);
  if (!parsed.success) {
    sendZodError(reply, parsed.error);
    return null;
  }

  return parsed.data;
}

function serializeVisualReport(report: Record<string, unknown>) {
  return {
    ...report,
    createdAt: report.createdAt instanceof Date ? report.createdAt.toISOString() : report.createdAt
  };
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "会议总结长图";
}
