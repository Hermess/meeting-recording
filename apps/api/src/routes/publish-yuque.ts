import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { PROJECT_BIWEEKLY_TEMPLATE } from "@meeting-ai-kit/visual-renderer";
import type { MeetingMinutesJson } from "@meeting-ai-kit/shared";
import { prisma } from "../prisma.js";
import { MARKDOWN_UNSYNCED_MESSAGE } from "../services/minutes-state.js";
import { requireAuthContext, scopedMeetingWhere } from "../services/auth.js";
import { getYuquePrivateConfig } from "../services/runtime-config.js";
import { auditMinutesQuality, buildMinutesQualityError } from "../services/minutes-quality.js";
import { renderVisualReportScreenshot } from "../services/visual-report.js";
import { imageToMarkdownDataUri, YuqueAdapter } from "../services/yuque.js";
import { sendNotFound, sendZodError } from "../utils/http.js";

const MeetingParamsSchema = z.object({
  id: z.string().min(1)
});

const PublishYuqueInputSchema = z.object({
  namespace: z.string().min(1).optional(),
  publicLevel: z.number().int().min(0).max(2).optional(),
  includeRecordings: z.boolean().optional()
});

const MAX_INLINE_RECORDING_BYTES = 20 * 1024 * 1024;

export async function registerYuquePublishRoutes(app: FastifyInstance) {
  app.post("/meetings/:id/publish-yuque", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) {
      return;
    }
    const params = parseMeetingParams(request, reply);
    if (!params) {
      return;
    }
    const parsed = PublishYuqueInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendZodError(reply, parsed.error);
    }

    const meeting = await prisma.meeting.findFirst({
      where: scopedMeetingWhere(auth, params.id),
      include: {
        meetingMinutes: { orderBy: { createdAt: "desc" }, take: 1 },
        visualReports: { orderBy: { createdAt: "desc" }, take: 1 },
        recordingAssets: { orderBy: { createdAt: "asc" } },
        transcriptSegments: { orderBy: { index: "asc" } }
      }
    });

    if (!meeting) {
      return sendNotFound(reply, "Meeting");
    }
    if (meeting.lastError === MARKDOWN_UNSYNCED_MESSAGE) {
      return reply.code(409).send({
        error: "minutes_needs_apply",
        message: MARKDOWN_UNSYNCED_MESSAGE
      });
    }

    const minutes = meeting.meetingMinutes[0];
    if (!minutes) {
      return reply.code(400).send({
        error: "missing_minutes",
        message: "请先生成会议纪要，再发布到语雀。"
      });
    }

    const minutesJson = minutes.structuredJson as unknown as MeetingMinutesJson;
    const audit = auditMinutesQuality({
      minutes: minutesJson,
      modelConfigId: minutes.modelConfigId,
      rawTranscript: meeting.transcriptSegments.map((segment) => segment.text).join("\n")
    });
    if (!audit.approved) {
      const message = buildMinutesQualityError(audit);
      await prisma.meeting.update({ where: { id: meeting.id }, data: { lastError: message } });
      return reply.code(422).send({
        error: "minutes_quality_audit_failed",
        message,
        audit
      });
    }

    const namespace = parsed.data.namespace ?? meeting.yuqueRepoNamespace;
    if (!namespace) {
      return reply.code(400).send({
        error: "missing_yuque_repo",
        message: "请选择要发布到的语雀知识库。"
      });
    }
    const publicLevel = parsed.data.publicLevel ?? meeting.yuquePublicLevel ?? 0;
    const includeRecordings = parsed.data.includeRecordings ?? false;
    if (includeRecordings) {
      const oversizedRecording = meeting.recordingAssets.find((asset) => asset.sizeBytes > MAX_INLINE_RECORDING_BYTES);
      if (oversizedRecording) {
        return reply.code(413).send({
          error: "recording_too_large_for_inline_yuque",
          message: `录音片段 ${oversizedRecording.filename} 大小为 ${formatFileSize(oversizedRecording.sizeBytes)}，超过当前可内嵌到语雀正文的 ${formatFileSize(MAX_INLINE_RECORDING_BYTES)} 限制。请接入语雀附件上传/OAuth 或对象存储后再随文档发布录音。`
        });
      }
    }
    const title = buildDocTitle(meeting.title);

    const log = await prisma.yuquePublishLog.create({
      data: {
        meetingId: meeting.id,
        docTitle: title,
        namespace,
        publicLevel,
        status: "pending"
      }
    });

    await prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        status: "publishing",
        yuqueRepoNamespace: namespace,
        yuquePublicLevel: publicLevel,
        lastError: null
      }
    });

    try {
      const visualReport = await ensureVisualReport(meeting.id, meeting.visualTemplateId, minutes.structuredJson);
      const config = await getYuquePrivateConfig(auth.user?.id);
      const adapter = new YuqueAdapter(config);
      const body = await buildYuqueBody({
        meeting,
        minutesMarkdown: minutes.markdownContent,
        imagePath: visualReport.imagePath,
        includeRecordings
      });
      const doc = await adapter.createDoc({
        namespace,
        title,
        slug: buildSlug(meeting.id),
        body,
        publicLevel
      });
      const tocResult = await adapter.ensureDocInToc({
        namespace,
        doc
      });

      await prisma.$transaction([
        prisma.yuquePublishLog.update({
          where: { id: log.id },
          data: {
            status: "success",
            docUrl: doc.url
          }
        }),
        prisma.meeting.update({
          where: { id: meeting.id },
          data: {
            status: "published",
            yuqueDocUrl: doc.url,
            lastError: null
          }
        })
      ]);

      return {
        status: "success",
        docUrl: doc.url,
        tocInserted: tocResult.inserted
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "发布语雀失败";
      await prisma.$transaction([
        prisma.yuquePublishLog.update({
          where: { id: log.id },
          data: {
            status: "failed",
            errorMessage: message
          }
        }),
        prisma.meeting.update({
          where: { id: meeting.id },
          data: {
            status: "ready_to_publish",
            lastError: message
          }
        })
      ]);
      return reply.code(500).send({
        error: "publish_yuque_failed",
        message
      });
    }
  });
}

async function ensureVisualReport(meetingId: string, templateId: string, visualJson: Prisma.JsonValue) {
  const existing = await prisma.visualReport.findFirst({
    where: { meetingId },
    orderBy: { createdAt: "desc" }
  });

  if (existing?.imagePath) {
    return existing;
  }

  const screenshot = await renderVisualReportScreenshot({
    meetingId,
    templateId,
    width: PROJECT_BIWEEKLY_TEMPLATE.width,
    scale: PROJECT_BIWEEKLY_TEMPLATE.scale,
    structuredJson: visualJson as unknown as MeetingMinutesJson
  });

  return prisma.visualReport.create({
    data: {
      meetingId,
      templateId,
      visualJson: visualJson as Prisma.InputJsonValue,
      htmlPath: screenshot.renderUrl,
      imagePath: screenshot.imagePath,
      imageUrl: screenshot.imageUrl,
      width: PROJECT_BIWEEKLY_TEMPLATE.width,
      scale: PROJECT_BIWEEKLY_TEMPLATE.scale
    }
  });
}

async function buildYuqueBody(input: {
  meeting: {
    title: string;
    projectName: string | null;
    participants: Prisma.JsonValue;
    startTime: Date | null;
    endTime: Date | null;
    recordingAssets?: Array<{ filename: string; mimeType: string; sizeBytes: number; storagePath?: string; publicUrl: string; createdAt: Date }>;
  };
  minutesMarkdown: string;
  imagePath?: string | null;
  includeRecordings?: boolean;
}) {
  const participants = Array.isArray(input.meeting.participants) ? input.meeting.participants.join("、") : "待定";
  const imageMarkdown = await imageToMarkdownDataUri(input.imagePath);
  const recordingsMarkdown = input.includeRecordings === true ? await buildRecordingsMarkdown(input.meeting.recordingAssets ?? []) : "";
  return [
    `# 纪要_${input.meeting.title}`,
    "",
    "> 本文档由智能妙记生成，包含会议信息、总结长图和可检索的纪要正文。",
    "",
    "## 纪要信息",
    "",
    `- 主题：${input.meeting.title}`,
    `- 时间：${formatDate(input.meeting.startTime)} 至 ${formatDate(input.meeting.endTime)}`,
    `- 参与人：${participants || "待定"}`,
    "",
    imageMarkdown ? "## 总结长图" : "",
    imageMarkdown,
    "",
    recordingsMarkdown ? "## 会议录音" : "",
    recordingsMarkdown,
    "",
    "## 纪要正文",
    "",
    input.minutesMarkdown
  ].filter((line) => line !== "").join("\n");
}

async function buildRecordingsMarkdown(recordings: Array<{ filename: string; mimeType: string; sizeBytes: number; storagePath?: string; publicUrl: string; createdAt: Date }>) {
  if (recordings.length === 0) {
    return "";
  }
  const completeRecordings = recordings.filter((recording) => isCompleteRecording(recording.filename));
  const publishRecordings = completeRecordings.length > 0 ? completeRecordings : recordings;
  const lines = [
    "> 注意：当前语雀 Token 接口没有公开附件上传能力。小录音会尝试以内嵌文件方式写入正文；长会议录音请接入语雀附件上传/OAuth 或对象存储。",
    ""
  ];

  for (const [index, recording] of publishRecordings.entries()) {
    const localDataUri = await localRecordingDataUri(recording);
    const url = localDataUri ?? absoluteAssetUrl(recording.publicUrl);
    const label = completeRecordings.length > 0 ? `完整录音 ${index + 1}` : `录音片段 ${index + 1}`;
    lines.push(`<audio controls src="${url}"></audio>`);
    lines.push(`- [下载${label}（${formatFileSize(recording.sizeBytes)}，${recording.mimeType}）](${url})`);
    if (index < publishRecordings.length - 1) {
      lines.push("");
    }
  }

  return lines.join("\n");
}

function isCompleteRecording(filename: string) {
  return filename.includes("complete-recording");
}

function buildDocTitle(title: string) {
  return `纪要_${title}_${new Date().toISOString().slice(0, 10)}`;
}

function buildSlug(meetingId: string) {
  return `meeting-${meetingId}-${Date.now().toString(36)}`.slice(0, 60);
}

function formatDate(value: Date | null) {
  return value ? value.toISOString().replace("T", " ").slice(0, 16) : "待定";
}

function absoluteAssetUrl(publicUrl: string) {
  if (/^https?:\/\//i.test(publicUrl)) {
    return publicUrl;
  }
  const baseUrl = process.env.API_PUBLIC_BASE_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`;
  return `${baseUrl.replace(/\/$/, "")}${publicUrl.startsWith("/") ? publicUrl : `/${publicUrl}`}`;
}

function isLocalhostUrl(value: string) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return true;
  }
}

async function localRecordingDataUri(recording: { mimeType: string; sizeBytes: number; storagePath?: string }) {
  if (!recording.storagePath || recording.sizeBytes > MAX_INLINE_RECORDING_BYTES) {
    return null;
  }
  const bytes = await readFile(recording.storagePath).catch(() => null);
  if (!bytes) {
    return null;
  }
  return `data:${recording.mimeType};base64,${bytes.toString("base64")}`;
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  }
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function parseMeetingParams(request: FastifyRequest, reply: FastifyReply) {
  const parsed = MeetingParamsSchema.safeParse(request.params);
  if (!parsed.success) {
    sendZodError(reply, parsed.error);
    return null;
  }
  return parsed.data;
}
