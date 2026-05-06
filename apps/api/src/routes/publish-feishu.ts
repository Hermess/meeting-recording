import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { PROJECT_BIWEEKLY_TEMPLATE } from "@meeting-ai-kit/visual-renderer";
import { FakeFeishuCliAdapter, ShellFeishuCliAdapter, type FeishuCliAdapter } from "@meeting-ai-kit/feishu-cli-adapter";
import { MeetingMinutesJsonSchema, type MeetingMinutesJson } from "@meeting-ai-kit/shared";
import { prisma } from "../prisma.js";
import { requireAuthContext, scopedMeetingWhere } from "../services/auth.js";
import { MARKDOWN_UNSYNCED_MESSAGE } from "../services/minutes-state.js";
import { auditMinutesQuality, buildMinutesQualityError } from "../services/minutes-quality.js";
import { renderVisualReportScreenshot } from "../services/visual-report.js";
import { getFeishuPublicConfig } from "../services/runtime-config.js";
import { sendNotFound, sendZodError } from "../utils/http.js";

const MeetingParamsSchema = z.object({
  id: z.string().min(1)
});

export async function registerFeishuPublishRoutes(app: FastifyInstance) {
  app.post("/meetings/:id/publish-feishu", async (request, reply) => {
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
        visualReports: { orderBy: { createdAt: "desc" }, take: 1 },
        transcriptSegments: { orderBy: { index: "asc" } }
      }
    });

    if (!meeting) {
      return sendNotFound(reply, "Meeting");
    }

    const minutesRecord = meeting.meetingMinutes[0];
    if (!minutesRecord) {
      return reply.code(400).send({
        error: "missing_minutes",
        message: "请先生成结构化纪要，再发布飞书。"
      });
    }

    if (meeting.lastError === MARKDOWN_UNSYNCED_MESSAGE) {
      return reply.code(409).send({
        error: "markdown_needs_sync",
        message: MARKDOWN_UNSYNCED_MESSAGE
      });
    }

    const parsedMinutes = MeetingMinutesJsonSchema.safeParse(minutesRecord.structuredJson);
    if (!parsedMinutes.success) {
      return sendZodError(reply, parsedMinutes.error);
    }

    const audit = auditMinutesQuality({
      minutes: parsedMinutes.data,
      modelConfigId: minutesRecord.modelConfigId,
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

    const publishLog = await prisma.feishuPublishLog.create({
      data: {
        meetingId: meeting.id,
        docTitle: buildDocTitle(meeting.title),
        status: "pending"
      }
    });

    await prisma.meeting.update({
      where: { id: meeting.id },
      data: { status: "publishing", lastError: null }
    });

    try {
      const adapter = await createFeishuAdapter(auth.user?.id);
      const authed = await adapter.checkAuthStatus();
      if (!authed) {
        throw new Error("飞书 CLI 未登录或未启用，请先完成 CLI 认证并开启 FEISHU_CLI_ENABLED。");
      }

      const visualReport = await ensureVisualReport(meeting.id, meeting.visualTemplateId, minutesRecord.structuredJson);
      if (!visualReport.imagePath) {
        throw new Error("总结长图缺少 imagePath。");
      }

      const createDocParams: { title: string; folder?: string } = { title: publishLog.docTitle };
      if (meeting.feishuFolder) {
        createDocParams.folder = meeting.feishuFolder;
      }
      const createdDoc = await adapter.createDoc(createDocParams);
      const uploadedImage = await adapter.uploadImage({ imagePath: visualReport.imagePath });

      await adapter.appendImage({ docToken: createdDoc.docToken, imageToken: uploadedImage.imageToken });
      await appendMinutesToFeishu(adapter, createdDoc.docToken, parsedMinutes.data);

      await prisma.$transaction([
        prisma.feishuPublishLog.update({
          where: { id: publishLog.id },
          data: {
            status: "success",
            docUrl: createdDoc.docUrl,
            cliCommandSummary: "createDoc, uploadImage, appendImage, appendHeading, appendParagraph, appendTable"
          }
        }),
        prisma.meeting.update({
          where: { id: meeting.id },
          data: {
            status: "published",
            feishuDocUrl: createdDoc.docUrl,
            lastError: null
          }
        })
      ]);

      return {
        status: "success",
        docUrl: createdDoc.docUrl
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "发布飞书失败";
      await prisma.$transaction([
        prisma.feishuPublishLog.update({
          where: { id: publishLog.id },
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
        error: "publish_feishu_failed",
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

async function appendMinutesToFeishu(adapter: FeishuCliAdapter, docToken: string, minutes: MeetingMinutesJson) {
  await adapter.appendHeading({ docToken, text: "一、会议背景", level: 1 });
  await adapter.appendParagraph({
    docToken,
    text: [
      `主题：${minutes.meeting_background.topic}`,
      `时间：${minutes.meeting_background.time}`,
      `参与人：${minutes.meeting_background.participants.join("、") || "待定"}`
    ].join("\n")
  });

  await adapter.appendHeading({ docToken, text: "二、会议总结", level: 1 });
  await adapter.appendParagraph({
    docToken,
    text: `${minutes.executive_summary.one_sentence_conclusion}\n\n${minutes.executive_summary.summary_paragraph}`
  });

  await adapter.appendHeading({ docToken, text: "三、模块进展", level: 1 });
  for (const module of minutes.module_progress) {
    await adapter.appendHeading({ docToken, text: module.module_name, level: 2 });
    await adapter.appendParagraph({
      docToken,
      text: [
        `负责人：${module.owner ?? "待定"}`,
        `当前状态：${module.current_status}`,
        `进展：${module.progress_items.join("；") || "无"}`,
        `阻塞：${module.blockers?.join("；") || "无"}`,
        `下一步：${module.next_steps?.join("；") || "待定"}`
      ].join("\n")
    });
  }

  await adapter.appendHeading({ docToken, text: "四、关键决策与共识", level: 1 });
  await adapter.appendParagraph({
    docToken,
    text: minutes.decisions.map((item, index) => `${index + 1}. [${item.type}] ${item.decision}`).join("\n") || "暂无"
  });

  await adapter.appendHeading({ docToken, text: "五、全局行动项汇总", level: 1 });
  await adapter.appendTable({
    docToken,
    columns: ["行动项", "负责人", "截止时间", "状态"],
    rows: minutes.action_items.map((item) => [
      item.action,
      item.owner,
      item.due_date,
      item.status
    ])
  });

  await adapter.appendHeading({ docToken, text: "六、AI 洞察", level: 1 });
  await adapter.appendParagraph({
    docToken,
    text: minutes.ai_insights.map((item) => `- ${item.title}：${item.content}${item.suggestion ? `\n  建议：${item.suggestion}` : ""}`).join("\n") || "暂无"
  });

  await adapter.appendHeading({ docToken, text: "七、待办", level: 1 });
  await adapter.appendParagraph({
    docToken,
    text: minutes.todos.map((item) => `${item.checked ? "[x]" : "[ ]"} ${item.text}`).join("\n") || "暂无"
  });

  await adapter.appendHeading({ docToken, text: "八、章节时间轴", level: 1 });
  await adapter.appendParagraph({
    docToken,
    text: minutes.chapters.map((item) => `${item.start_time} ${item.title}：${item.summary}`).join("\n") || "暂无"
  });
}

async function createFeishuAdapter(ownerUserId?: string) {
  const config = await getFeishuPublicConfig(ownerUserId);
  if (config.fakeMode) {
    return new FakeFeishuCliAdapter();
  }
  return new ShellFeishuCliAdapter({
    enabled: config.enabled,
    bin: config.bin,
    profile: config.profile,
    defaultFolder: config.defaultFolder
  });
}

function buildDocTitle(title: string) {
  const date = new Date().toISOString().slice(0, 10);
  return `纪要_${title}_${date}`;
}

function parseMeetingParams(request: FastifyRequest, reply: FastifyReply) {
  const parsed = MeetingParamsSchema.safeParse(request.params);
  if (!parsed.success) {
    sendZodError(reply, parsed.error);
    return null;
  }

  return parsed.data;
}
