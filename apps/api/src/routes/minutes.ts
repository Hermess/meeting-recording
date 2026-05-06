import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  MeetingMinutesJsonSchema,
  type Meeting,
  type TranscriptSegment
} from "@meeting-ai-kit/shared";
import {
  OpenAiCompatibleMeetingMinutesLlmAdapter,
  PROJECT_BIWEEKLY_PROMPT_VERSION,
  type LlmAdapterConfig
} from "@meeting-ai-kit/llm-adapter";
import { prisma } from "../prisma.js";
import { decryptSecret } from "../security/secrets.js";
import { requireAuthContext, scopedMeetingWhere } from "../services/auth.js";
import { buildFallbackMinutesJson } from "../services/fallback-minutes.js";
import { renderMinutesDocx } from "../services/minutes-docx.js";
import { auditMinutesQuality, buildMinutesQualityError } from "../services/minutes-quality.js";
import { MARKDOWN_UNSYNCED_MESSAGE } from "../services/minutes-state.js";
import { getPersonalHotwords } from "../services/runtime-config.js";
import { sendNotFound, sendZodError } from "../utils/http.js";

const MeetingParamsSchema = z.object({
  id: z.string().min(1)
});

const UpdateMinutesInputSchema = z
  .object({
    structuredJson: MeetingMinutesJsonSchema.optional(),
    markdownContent: z.string().min(1).optional()
  })
  .refine((value) => value.structuredJson !== undefined || value.markdownContent !== undefined, {
    message: "structuredJson 或 markdownContent 至少提供一个"
  });

const SyncStructuredJsonInputSchema = z.object({
  markdownContent: z.string().min(1).optional()
});

const GenerateMinutesInputSchema = z.object({
  modelConfigId: z.string().min(1).optional()
});

const llmAdapter = new OpenAiCompatibleMeetingMinutesLlmAdapter();

export async function registerMinutesRoutes(app: FastifyInstance) {
  app.post("/meetings/:id/generate-minutes", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) {
      return;
    }
    const params = parseMeetingParams(request, reply);
    if (!params) {
      return;
    }
    const parsedBody = GenerateMinutesInputSchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return sendZodError(reply, parsedBody.error);
    }

    const meeting = await prisma.meeting.findFirst({
      where: scopedMeetingWhere(auth, params.id),
      include: {
        transcriptSegments: { orderBy: { index: "asc" } }
      }
    });

    if (!meeting) {
      return sendNotFound(reply, "Meeting");
    }

    if (meeting.transcriptSegments.length === 0) {
      return reply.code(400).send({
        error: "missing_transcript",
        message: "请先录音或粘贴转写文本，再生成纪要。"
      });
    }

    const modelConfig =
      (parsedBody.data.modelConfigId ? await prisma.modelConfig.findFirst({ where: scopedModelConfigWhere(auth, parsedBody.data.modelConfigId) }) : null) ??
      (await prisma.modelConfig.findFirst({ where: scopedModelConfigWhere(auth, meeting.summaryModelConfigId) })) ??
      (await prisma.modelConfig.findFirst({ where: scopedModelConfigWhere(auth), orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] }));

    await prisma.meeting.update({
      where: { id: meeting.id },
      data: { status: "generating", lastError: null }
    });

    const meetingInput = serializeMeetingForLlm(meeting);
    const transcriptSegments = meeting.transcriptSegments.map(serializeTranscriptForLlm);
    const rawTranscript = transcriptSegments.map((segment) => segment.text).join("\n");
    const hotwords = await getPersonalHotwords(auth.user?.id);

    try {
      const usedFallback = !modelConfig;
      let result = modelConfig
        ? await llmAdapter.generateMinutes(toLlmConfig(modelConfig), {
            meeting: meetingInput,
            transcriptSegments,
            hotwords,
            promptVersion: PROJECT_BIWEEKLY_PROMPT_VERSION
          })
        : {
            structuredJson: buildFallbackMinutesJson(meeting, meeting.transcriptSegments),
            rawOutput: "fallback_minutes_without_model_config",
            repaired: false
          };
      if (modelConfig) {
        const audit = auditMinutesQuality({
          minutes: result.structuredJson,
          modelConfigId: modelConfig.id,
          rawTranscript
        });
        if (!audit.approved) {
          const refined = await llmAdapter.refineMinutes(toLlmConfig(modelConfig), {
            meeting: meetingInput,
            transcriptSegments,
            hotwords,
            promptVersion: PROJECT_BIWEEKLY_PROMPT_VERSION,
            previousStructuredJson: result.structuredJson,
            qualityIssues: [...audit.issues, ...audit.warnings]
          });
          const refinedAudit = auditMinutesQuality({
            minutes: refined.structuredJson,
            modelConfigId: modelConfig.id,
            rawTranscript
          });
          if (!refinedAudit.approved) {
            throw new Error(buildMinutesQualityError(refinedAudit));
          }
          result = {
            ...refined,
            repaired: result.repaired || refined.repaired
          };
        }
      }

      const markdownContent = renderMinutesMarkdown(result.structuredJson);

      const saved = await prisma.$transaction(async (tx) => {
        const minutes = await tx.meetingMinutes.create({
          data: {
            meetingId: meeting.id,
            rawTranscript,
            structuredJson: result.structuredJson as unknown as Prisma.InputJsonValue,
            markdownContent,
            feishuDocBlocks: [],
            modelConfigId: modelConfig?.id ?? "fallback_basic_v1",
            promptVersion: PROJECT_BIWEEKLY_PROMPT_VERSION
          }
        });

        await tx.actionItem.deleteMany({ where: { meetingId: meeting.id } });
        await tx.visualReport.deleteMany({ where: { meetingId: meeting.id } });
        if (result.structuredJson.action_items.length > 0) {
          await tx.actionItem.createMany({
            data: result.structuredJson.action_items.map((item) => ({
              meetingId: meeting.id,
              action: item.action,
              owner: item.owner,
              dueDate: item.due_date,
              status: mapMinutesActionStatus(item.status),
              evidenceSegmentIds: item.evidence_segment_ids ?? []
            }))
          });
        }

        await tx.meeting.update({
          where: { id: meeting.id },
          data: {
            status: "generated",
            summaryModelConfigId: modelConfig?.id ?? meeting.summaryModelConfigId,
            lastError: null
          }
        });

        return minutes;
      });

      return {
        data: serializeMinutes(saved),
        repaired: result.repaired,
        fallback: usedFallback
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "纪要生成失败";

      try {
        const fallbackJson = buildFallbackMinutesJson(meeting, meeting.transcriptSegments);
        const markdownContent = renderMinutesMarkdown(fallbackJson);
        const saved = await prisma.$transaction(async (tx) => {
          const minutes = await tx.meetingMinutes.create({
            data: {
              meetingId: meeting.id,
              rawTranscript,
              structuredJson: fallbackJson as unknown as Prisma.InputJsonValue,
              markdownContent,
              feishuDocBlocks: [],
              modelConfigId: modelConfig ? `${modelConfig.id}:fallback_after_model_error` : "fallback_basic_v1",
              promptVersion: PROJECT_BIWEEKLY_PROMPT_VERSION
            }
          });

          await tx.actionItem.deleteMany({ where: { meetingId: meeting.id } });
          await tx.visualReport.deleteMany({ where: { meetingId: meeting.id } });
          if (fallbackJson.action_items.length > 0) {
            await tx.actionItem.createMany({
              data: fallbackJson.action_items.map((item) => ({
                meetingId: meeting.id,
                action: item.action,
                owner: item.owner,
                dueDate: item.due_date,
                status: mapMinutesActionStatus(item.status),
                evidenceSegmentIds: item.evidence_segment_ids ?? []
              }))
            });
          }

          await tx.meeting.update({
            where: { id: meeting.id },
            data: { status: "generated", lastError: message }
          });

          return minutes;
        });

        return {
          data: serializeMinutes(saved),
          repaired: false,
          fallback: true,
          modelError: message
        };
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "基础纪要兜底生成失败";
        await prisma.meeting.update({
          where: { id: meeting.id },
          data: {
            status: "failed",
            lastError: `${message}；${fallbackMessage}`
          }
        });

        return reply.code(500).send({
          error: "generate_minutes_failed",
          message: `${message}；${fallbackMessage}`
        });
      }
    }
  });

  app.get("/meetings/:id/minutes", async (request, reply) => {
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

    const minutes = await prisma.meetingMinutes.findFirst({
      where: { meetingId: meeting.id },
      orderBy: { createdAt: "desc" }
    });

    if (!minutes) {
      return sendNotFound(reply, "Meeting minutes");
    }

    return { data: serializeMinutes(minutes) };
  });

  app.get("/meetings/:id/minutes.docx", async (request, reply) => {
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
        visualReports: { orderBy: { createdAt: "desc" }, take: 1 }
      }
    });

    if (!meeting) {
      return sendNotFound(reply, "Meeting");
    }

    const minutes = meeting.meetingMinutes[0];
    if (!minutes) {
      return sendNotFound(reply, "Meeting minutes");
    }

    const structuredJson = MeetingMinutesJsonSchema.parse(minutes.structuredJson);
    const docxParams = {
      title: meeting.title,
      minutes: structuredJson
    };
    const visualImagePath = meeting.visualReports[0]?.imagePath;
    const buffer = await renderMinutesDocx(visualImagePath ? { ...docxParams, visualImagePath } : docxParams);

    return reply
      .header("content-type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
      .header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${safeFileName(meeting.title)}-纪要.docx`)}`)
      .send(buffer);
  });

  app.post("/meetings/:id/minutes/sync-structured-json", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) {
      return;
    }
    const params = parseMeetingParams(request, reply);
    if (!params) {
      return;
    }

    const parsedInput = SyncStructuredJsonInputSchema.safeParse(request.body ?? {});
    if (!parsedInput.success) {
      return sendZodError(reply, parsedInput.error);
    }

    const meeting = await prisma.meeting.findFirst({
      where: scopedMeetingWhere(auth, params.id),
      include: {
        meetingMinutes: { orderBy: { createdAt: "desc" }, take: 1 }
      }
    });

    if (!meeting) {
      return sendNotFound(reply, "Meeting");
    }

    const latest = meeting.meetingMinutes[0];
    if (!latest) {
      return sendNotFound(reply, "Meeting minutes");
    }

    const previousStructuredJson = MeetingMinutesJsonSchema.parse(latest.structuredJson);
    const markdownContent = parsedInput.data.markdownContent ?? latest.markdownContent;
    const modelConfig =
      (await prisma.modelConfig.findFirst({ where: scopedModelConfigWhere(auth, meeting.summaryModelConfigId) })) ??
      (await prisma.modelConfig.findFirst({ where: scopedModelConfigWhere(auth), orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] }));

    if (!modelConfig) {
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: { lastError: "缺少可用纪要模型配置，无法应用正文修改。" }
      });
      return reply.code(400).send({
        error: "missing_model_config",
        message: "缺少可用纪要模型配置，无法应用正文修改。"
      });
    }

    try {
      const result = await llmAdapter.syncMinutesJsonFromMarkdown(toLlmConfig(modelConfig), {
        meeting: serializeMeetingForLlm(meeting),
        markdownContent,
        previousStructuredJson
      });

      const updated = await prisma.$transaction(async (tx) => {
        const minutes = await tx.meetingMinutes.update({
          where: { id: latest.id },
          data: {
            structuredJson: result.structuredJson as unknown as Prisma.InputJsonValue,
            markdownContent,
            modelConfigId: modelConfig.id
          }
        });

        await tx.actionItem.deleteMany({ where: { meetingId: meeting.id } });
        if (result.structuredJson.action_items.length > 0) {
          await tx.actionItem.createMany({
            data: result.structuredJson.action_items.map((item) => ({
              meetingId: meeting.id,
              action: item.action,
              owner: item.owner,
              dueDate: item.due_date,
              status: mapMinutesActionStatus(item.status),
              evidenceSegmentIds: item.evidence_segment_ids ?? []
            }))
          });
        }

        await tx.visualReport.deleteMany({ where: { meetingId: meeting.id } });
        await tx.meeting.update({
          where: { id: meeting.id },
          data: { status: "generated", lastError: null }
        });

        return minutes;
      });

      return {
        data: serializeMinutes(updated),
        repaired: result.repaired
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "应用正文修改失败。";
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: { lastError: message }
      });
      return reply.code(500).send({
        error: "sync_structured_json_failed",
        message
      });
    }
  });

  app.patch("/meetings/:id/minutes", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) {
      return;
    }
    const params = parseMeetingParams(request, reply);
    if (!params) {
      return;
    }

    const parsed = UpdateMinutesInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendZodError(reply, parsed.error);
    }

    const meeting = await prisma.meeting.findFirst({
      where: scopedMeetingWhere(auth, params.id),
      select: { id: true }
    });
    if (!meeting) {
      return sendNotFound(reply, "Meeting");
    }

    const latest = await prisma.meetingMinutes.findFirst({
      where: { meetingId: meeting.id },
      orderBy: { createdAt: "desc" }
    });

    if (!latest) {
      return sendNotFound(reply, "Meeting minutes");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const previousStructuredJson = MeetingMinutesJsonSchema.parse(latest.structuredJson);
      const nextStructuredJson = parsed.data.structuredJson ?? previousStructuredJson;
      const markdownOnly = parsed.data.markdownContent !== undefined && parsed.data.structuredJson === undefined;
      const minutes = await tx.meetingMinutes.update({
        where: { id: latest.id },
        data: {
          structuredJson: nextStructuredJson as unknown as Prisma.InputJsonValue,
          markdownContent: parsed.data.markdownContent ?? renderMinutesMarkdown(nextStructuredJson)
        }
      });

      if (parsed.data.structuredJson !== undefined) {
        await tx.actionItem.deleteMany({ where: { meetingId: meeting.id } });
      }
      if (parsed.data.structuredJson !== undefined && parsed.data.structuredJson.action_items.length > 0) {
        await tx.actionItem.createMany({
          data: parsed.data.structuredJson.action_items.map((item) => ({
            meetingId: meeting.id,
            action: item.action,
            owner: item.owner,
            dueDate: item.due_date,
            status: mapMinutesActionStatus(item.status),
            evidenceSegmentIds: item.evidence_segment_ids ?? []
          }))
        });
      }

      if (markdownOnly) {
        await tx.meeting.update({
          where: { id: meeting.id },
          data: { lastError: MARKDOWN_UNSYNCED_MESSAGE }
        });
      }

      return minutes;
    });

    return { data: serializeMinutes(updated) };
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

function scopedModelConfigWhere(auth: { enabled: boolean; user: { id: string } | null }, id?: string): Prisma.ModelConfigWhereInput {
  return {
    ...(id ? { id } : {}),
    ...(auth.enabled && auth.user ? { ownerUserId: auth.user.id } : {}),
    enabled: true
  };
}

function toLlmConfig(modelConfig: {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKeyEncrypted: string;
  model: string;
  temperature: number;
  maxTokens: number;
  jsonMode: boolean;
  timeoutMs: number;
  retryCount: number;
  enabled: boolean;
}): LlmAdapterConfig {
  return {
    id: modelConfig.id,
    name: modelConfig.name,
    provider: modelConfig.provider as LlmAdapterConfig["provider"],
    baseUrl: modelConfig.baseUrl,
    apiKeyEncrypted: decryptSecret(modelConfig.apiKeyEncrypted),
    model: modelConfig.model,
    temperature: modelConfig.temperature,
    maxTokens: modelConfig.maxTokens,
    jsonMode: modelConfig.jsonMode,
    timeoutMs: modelConfig.timeoutMs,
    retryCount: modelConfig.retryCount,
    enabled: modelConfig.enabled,
    isDefault: false
  };
}

function serializeMeetingForLlm(meeting: Record<string, unknown>): Meeting {
  return {
    id: String(meeting.id),
    title: String(meeting.title),
    meetingType: String(meeting.meetingType),
    inputMode: meeting.inputMode === "upload" ? "upload" : "record",
    startTime: meeting.startTime instanceof Date ? meeting.startTime.toISOString() : undefined,
    endTime: meeting.endTime instanceof Date ? meeting.endTime.toISOString() : undefined,
    status: meeting.status as Meeting["status"],
    participants: Array.isArray(meeting.participants) ? (meeting.participants as string[]) : [],
    summaryModelConfigId: String(meeting.summaryModelConfigId),
    visualTemplateId: String(meeting.visualTemplateId),
    feishuFolder: typeof meeting.feishuFolder === "string" ? meeting.feishuFolder : undefined,
    feishuDocUrl: typeof meeting.feishuDocUrl === "string" ? meeting.feishuDocUrl : undefined,
    yuqueRepoNamespace: typeof meeting.yuqueRepoNamespace === "string" ? meeting.yuqueRepoNamespace : undefined,
    yuquePublicLevel: typeof meeting.yuquePublicLevel === "number" ? meeting.yuquePublicLevel : undefined,
    yuqueDocUrl: typeof meeting.yuqueDocUrl === "string" ? meeting.yuqueDocUrl : undefined,
    lastError: typeof meeting.lastError === "string" ? meeting.lastError : undefined,
    createdAt: meeting.createdAt instanceof Date ? meeting.createdAt.toISOString() : String(meeting.createdAt),
    updatedAt: meeting.updatedAt instanceof Date ? meeting.updatedAt.toISOString() : String(meeting.updatedAt)
  };
}

function serializeTranscriptForLlm(segment: Record<string, unknown>): TranscriptSegment {
  return {
    id: String(segment.id),
    meetingId: String(segment.meetingId),
    index: Number(segment.index),
    speaker: typeof segment.speaker === "string" ? segment.speaker : undefined,
    startMs: typeof segment.startMs === "number" ? segment.startMs : undefined,
    endMs: typeof segment.endMs === "number" ? segment.endMs : undefined,
    text: String(segment.text),
    isFinal: Boolean(segment.isFinal),
    provider: segment.provider as TranscriptSegment["provider"],
    rawPayload: segment.rawPayload,
    createdAt: segment.createdAt instanceof Date ? segment.createdAt.toISOString() : String(segment.createdAt),
    updatedAt: segment.updatedAt instanceof Date ? segment.updatedAt.toISOString() : undefined
  };
}

function serializeMinutes(minutes: Record<string, unknown>) {
  return {
    ...minutes,
    createdAt: minutes.createdAt instanceof Date ? minutes.createdAt.toISOString() : minutes.createdAt,
    updatedAt: minutes.updatedAt instanceof Date ? minutes.updatedAt.toISOString() : minutes.updatedAt
  };
}

function renderMinutesMarkdown(minutes: z.infer<typeof MeetingMinutesJsonSchema>) {
  const lines = [
    `# ${minutes.meeting_background.title}`,
    "",
    "## 会议背景",
    "",
    `- 主题：${minutes.meeting_background.topic}`,
    `- 时间：${minutes.meeting_background.time}`,
    `- 参与人：${minutes.meeting_background.participants.join("、") || "待定"}`,
    "",
    "## 会议总结",
    "",
    `**一句话结论：** ${minutes.executive_summary.one_sentence_conclusion}`,
    "",
    minutes.executive_summary.summary_paragraph
  ];

  const moduleProgress = minutes.module_progress.filter((module) => isMeaningfulText(module.module_name) && (isMeaningfulText(module.current_status) || module.progress_items.some(isMeaningfulText)));
  if (moduleProgress.length > 0) {
    lines.push(
      "",
      "## 模块进展",
      "",
      ...moduleProgress.flatMap((module) => [
      `### ${module.module_name}${module.owner ? `（${module.owner}）` : ""}`,
      "",
      `- 当前状态：${module.current_status}`,
      ...module.progress_items.filter(isMeaningfulText).map((item) => `- 进展：${item}`),
      ...(module.blockers ?? []).filter(isMeaningfulText).map((item) => `- 阻塞：${item}`),
      ...(module.next_steps ?? []).filter(isMeaningfulText).map((item) => `- 下一步：${item}`),
      ""
      ])
    );
  }

  const decisions = minutes.decisions.filter((item) => isMeaningfulText(item.decision));
  if (decisions.length > 0) {
    lines.push(
      "",
      "## 关键决策与共识",
      "",
      ...decisions.map((item, index) => `${index + 1}. [${item.type}] ${item.decision}`)
    );
  }

  const actionItems = minutes.action_items.filter((item) => isMeaningfulText(item.action));
  if (actionItems.length > 0) {
    lines.push(
      "",
      "## 全局行动项汇总",
      "",
      "| 行动项 | 负责人 | 截止时间 | 状态 |",
      "| --- | --- | --- | --- |",
      ...actionItems.map((item) =>
      `| ${escapeMarkdownTableCell(item.action)} | ${escapeMarkdownTableCell(item.owner)} | ${escapeMarkdownTableCell(item.due_date)} | ${escapeMarkdownTableCell(item.status)} |`
      )
    );
  }

  const insights = minutes.ai_insights.filter((item) => isMeaningfulText(item.title) || isMeaningfulText(item.content));
  if (insights.length > 0) {
    lines.push(
      "",
      "## AI 洞察",
      "",
      ...insights.map((item) => `- ${item.title}：${item.content}${item.suggestion ? ` 建议：${item.suggestion}` : ""}`)
    );
  }

  const todos = minutes.todos.filter((item) => isMeaningfulText(item.text));
  if (todos.length > 0) {
    lines.push("", "## 待办", "", ...todos.map((item) => `- [${item.checked ? "x" : " "}] ${item.text}`));
  }

  const chapters = minutes.chapters.filter((chapter) => isMeaningfulText(chapter.title) && isMeaningfulText(chapter.summary));
  if (chapters.length > 0) {
    lines.push("", "## 章节", "", ...chapters.map((chapter) => `- ${chapter.start_time} ${chapter.title}：${chapter.summary}`));
  }

  return lines.join("\n");
}

function escapeMarkdownTableCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function isMeaningfulText(value: string | undefined | null) {
  const normalized = `${value ?? ""}`.trim();
  return Boolean(normalized && !["暂无", "无", "无明确", "待定", "-", "--", "---", "null", "undefined"].includes(normalized));
}

function mapMinutesActionStatus(status: z.infer<typeof MeetingMinutesJsonSchema>["action_items"][number]["status"]) {
  const map = {
    待推进: "pending",
    进行中: "in_progress",
    已完成: "done",
    阻塞: "blocked",
    待定: "unknown"
  } as const;

  return map[status];
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "会议纪要";
}
