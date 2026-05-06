import { z, type ZodError } from "zod";
import type { Meeting, MeetingMinutesJson, ModelConfig, TranscriptSegment } from "@meeting-ai-kit/shared";
import { MeetingMinutesJsonSchema, ModelConfigSchema, ModelProviderIdSchema } from "@meeting-ai-kit/shared";

export const LLM_PROVIDER_PRESETS = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    compatibility: "openai_chat_completions"
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    compatibility: "openai_chat_completions"
  },
  {
    id: "qwen",
    name: "通义千问 / Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    compatibility: "openai_chat_completions"
  },
  {
    id: "doubao",
    name: "豆包大模型",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    compatibility: "openai_chat_completions"
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    compatibility: "openai_chat_completions"
  },
  {
    id: "kimi",
    name: "Kimi / Moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    compatibility: "openai_chat_completions"
  },
  {
    id: "minimax",
    name: "MiniMax",
    baseUrl: "https://api.minimaxi.com/v1",
    compatibility: "openai_chat_completions"
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    compatibility: "openai_chat_completions"
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    compatibility: "openai_chat_completions"
  },
  {
    id: "ollama",
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    compatibility: "openai_chat_completions"
  },
  {
    id: "model_gateway",
    name: "模型网关",
    baseUrl: "",
    compatibility: "openai_chat_completions"
  },
  {
    id: "custom_gateway",
    name: "自定义模型网关",
    baseUrl: "",
    compatibility: "openai_chat_completions",
    defaultModel: "deepseek-v4-pro",
    defaultConfigName: "自定义网关 DeepSeek V4 Pro"
  }
] as const;

export const LlmProviderPresetSchema = z.object({
  id: ModelProviderIdSchema,
  name: z.string(),
  baseUrl: z.string().url(),
  compatibility: z.literal("openai_chat_completions"),
  defaultModel: z.string().optional(),
  defaultApiKey: z.string().optional(),
  defaultConfigName: z.string().optional()
});

export type LlmProviderPreset = z.infer<typeof LlmProviderPresetSchema>;

export const LlmAdapterConfigSchema = ModelConfigSchema.extend({
  provider: ModelProviderIdSchema,
  timeoutMs: z.number().int().positive().default(240000),
  retryCount: z.number().int().nonnegative().default(1)
});

export type LlmAdapterConfig = z.infer<typeof LlmAdapterConfigSchema>;

export type GenerateMinutesInput = {
  meeting: Meeting;
  transcriptSegments: TranscriptSegment[];
  promptVersion: string;
  hotwords?: Array<{ term: string; type: string }>;
};

export type GenerateMinutesResult = {
  structuredJson: MeetingMinutesJson;
  rawOutput: string;
  repaired: boolean;
};

export type RepairJsonInput = {
  rawOutput: string;
  schemaErrors: string;
};

export type SyncMinutesJsonFromMarkdownInput = {
  meeting: Meeting;
  markdownContent: string;
  previousStructuredJson: MeetingMinutesJson;
};

export type RefineMinutesInput = GenerateMinutesInput & {
  previousStructuredJson: MeetingMinutesJson;
  qualityIssues: string[];
};

export interface MeetingMinutesLlmAdapter {
  testConnection(config: LlmAdapterConfig): Promise<{ ok: boolean; message: string }>;
  generateMinutes(config: LlmAdapterConfig, input: GenerateMinutesInput): Promise<GenerateMinutesResult>;
  repairJson(config: LlmAdapterConfig, input: RepairJsonInput): Promise<string>;
  refineMinutes(config: LlmAdapterConfig, input: RefineMinutesInput): Promise<GenerateMinutesResult>;
  syncMinutesJsonFromMarkdown(
    config: LlmAdapterConfig,
    input: SyncMinutesJsonFromMarkdownInput
  ): Promise<GenerateMinutesResult>;
}

export class LlmAdapterNotConfiguredError extends Error {
  constructor(provider: ModelConfig["provider"]) {
    super(`LLM provider "${provider}" is not configured. Fill model gateway settings before generating minutes.`);
    this.name = "LlmAdapterNotConfiguredError";
  }
}

export const PROJECT_BIWEEKLY_PROMPT_VERSION = "project_biweekly_v1";

const MEETING_MINUTES_JSON_SKELETON = `{
  "meeting_background": {
    "title": "会议标题",
    "topic": "会议主题",
    "time": "会议时间，缺失填待定",
    "participants": ["参会人，缺失则为空数组"],
    "project": "项目名称，可省略",
    "meeting_type": "会议类型"
  },
  "executive_summary": {
    "title": "总结标题",
    "subtitle": "总结副标题",
    "one_sentence_conclusion": "一句话结论",
    "summary_paragraph": "会议总结段落"
  },
  "visual_summary": {
    "milestones": [{ "date": "日期或待定", "title": "里程碑标题", "bullets": ["要点"] }],
    "risk_cards": [{ "title": "风险标题", "level": "高|中|低", "description": "风险描述", "impact": "影响，可省略", "suggestion": "建议，可省略" }],
    "key_actions": [{ "title": "行动标题", "owner": "负责人或待定", "due_date": "截止时间或待定", "status": "状态" }],
    "core_consensus": "核心共识"
  },
  "module_progress": [{ "module_name": "模块名称", "owner": "负责人，可省略", "current_status": "当前状态", "progress_items": ["进展"], "blockers": ["阻塞，可省略"], "next_steps": ["下一步，可省略"] }],
  "decisions": [{ "decision": "决策内容", "type": "已确认|待验证|风险提示", "evidence_text": "证据原文，可省略", "evidence_segment_ids": ["证据段落ID，可省略"] }],
  "action_items": [{ "action": "行动项", "owner": "负责人或待定", "due_date": "截止时间或待定", "status": "待推进|进行中|已完成|阻塞|待定", "evidence_text": "证据原文，可省略", "evidence_segment_ids": ["证据段落ID，可省略"] }],
  "ai_insights": [{ "title": "洞察标题", "content": "洞察内容", "risk_level": "高|中|低，可省略", "suggestion": "建议，可省略" }],
  "todos": [{ "text": "待办", "checked": false }],
  "chapters": [{ "start_time": "章节开始时间", "title": "章节标题", "summary": "章节摘要" }]
}`;

export const MEETING_MINUTES_SYSTEM_PROMPT = `你是一个企业会议纪要结构化助手。

你的任务是根据会议转写文本，生成适合飞书文档和会议总结长图展示的结构化 JSON。

要求：
1. 只输出合法 JSON，不输出 Markdown，不输出解释。
2. 不得编造会议中没有出现的信息。
3. 所有关键结论、风险和行动项应尽量引用原始会议内容作为 evidence_text。
4. 行动项必须包含 action、owner、due_date、status。
5. 如果负责人缺失，填“待定”。
6. 如果时间节点缺失，填“待定”。
7. AI洞察必须基于会议内容推导，不得泛泛而谈。
8. 输出内容要适合直接放入飞书文档和总结长图。
9. 中文表达要简洁、准确、适合管理者快速阅读。
10. 严格按照下面 JSON 结构输出，枚举值必须完全匹配。
11. 顶层必须是一个 JSON object，不允许输出数组、Markdown、解释、思考过程或额外文本。
12. 如果转写文本本身已经是会议纪要、Markdown、分章节材料或人工整理稿，要以原文章节语义为准进行结构化抽取，不要把“会议日期”“会议主题”“---”“一、二、三”这类元信息当作行动项、风险或决策。
13. 行动项只提取明确需要推进、确认、完成、评审、跟进、研究的任务；必须尽量保留原文负责人和日期，例如“2026年5月14日前确定技术方案”。
14. 风险只来自明确的风险、关注点、阻塞、问题或不确定性表述；不要把普通背景信息归为风险。
15. chapters 应按真实议题章节聚合。没有真实时间戳时，start_time 可以填“待定”或按章节顺序填“章节1/章节2”，不要把每一行粘贴文本拆成独立章节。
16. executive_summary.summary_paragraph 必须是归纳后的中文会议总结，不允许把原文按“；”机械拼接。建议 1-2 个自然段，覆盖会议目标、核心方案、关键决策、行动计划和主要风险。
17. module_progress 应按原文真实篇章或业务模块组织；对于“核心目标与安排、整体架构规划、关键技术决策、业务与开发协作、行动计划、风险与关注点”这类已整理稿，应保留这些篇章作为核心结构。
18. milestones 只放关键节点和里程碑日期，不要把“会议日期”当里程碑。
19. 输出前自行检查：会议总结是否像管理层纪要；章节是否与原文大纲对应；行动项是否都是可执行任务；风险是否来自原文风险章节。任何不符合项必须在最终 JSON 中修正。

JSON 结构：
${MEETING_MINUTES_JSON_SKELETON}`;

export function buildMeetingMinutesUserPrompt(input: GenerateMinutesInput) {
  const transcript = input.transcriptSegments
    .map((segment) => {
      const time = [segment.startMs, segment.endMs].every((value) => typeof value === "number")
        ? `${segment.startMs}-${segment.endMs}ms`
        : "time_unknown";
      return `segment_id=${segment.id}; index=${segment.index}; time=${time}; text=${segment.text}`;
    })
    .join("\n");

  return `会议类型：${input.meeting.meetingType}
会议主题：${input.meeting.title}
会议开始时间：${input.meeting.startTime ?? "待定"}
会议结束时间：${input.meeting.endTime ?? "待定"}
参会人：${input.meeting.participants.join("、") || "待定"}
个人热词：${input.hotwords?.length ? input.hotwords.map((item) => `${item.term}（${item.type}）`).join("、") : "无"}

以下是会议转写分段，每段包含 segment_id、时间和文本。
请基于这些内容生成结构化会议纪要 JSON。

${transcript}`;
}

export class OpenAiCompatibleMeetingMinutesLlmAdapter implements MeetingMinutesLlmAdapter {
  async testConnection(config: LlmAdapterConfig): Promise<{ ok: boolean; message: string }> {
    try {
      const output = await this.chat({ ...config, jsonMode: false, maxTokens: Math.min(config.maxTokens, 128) }, [
        { role: "system", content: "You are a health check assistant." },
        { role: "user", content: "请只回复 ok。" }
      ]);
      return { ok: true, message: `模型网关连接成功：${output.slice(0, 80)}` };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "模型网关连接失败"
      };
    }
  }

  async generateMinutes(config: LlmAdapterConfig, input: GenerateMinutesInput): Promise<GenerateMinutesResult> {
    const rawOutput = await this.chat(config, [
      { role: "system", content: MEETING_MINUTES_SYSTEM_PROMPT },
      { role: "user", content: buildMeetingMinutesUserPrompt(input) }
    ]);

    const firstPass = parseMeetingMinutesJson(rawOutput);
    if (firstPass.success) {
      return {
        structuredJson: firstPass.data,
        rawOutput,
        repaired: false
      };
    }

    const repairedOutput = await this.repairJson(config, {
      rawOutput,
      schemaErrors: formatZodError(firstPass.error)
    });
    const repaired = parseMeetingMinutesJson(repairedOutput);

    if (!repaired.success) {
      throw new Error(`模型输出无法修复为合法 MeetingMinutesJson：${formatZodError(repaired.error)}`);
    }

    return {
      structuredJson: repaired.data,
      rawOutput: repairedOutput,
      repaired: true
    };
  }

  async refineMinutes(config: LlmAdapterConfig, input: RefineMinutesInput): Promise<GenerateMinutesResult> {
    const rawOutput = await this.chat(config, [
      { role: "system", content: MEETING_MINUTES_SYSTEM_PROMPT },
      {
        role: "user",
        content: `${buildMeetingMinutesUserPrompt(input)}

上一次模型生成的结构化纪要未通过质量审核，请基于原始转写重新生成一版更专业的 MeetingMinutesJson。

质量问题：
${input.qualityIssues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")}

上一次结构化 JSON（只能作为反例和字段参考，不要照抄问题内容）：
${JSON.stringify(input.previousStructuredJson, null, 2)}

请重点修正：
1. 会议总结必须是归纳后的正式纪要表达，不要把原文句子用分号串起来。
2. 核心篇章要和原文大纲对应，尤其是目标安排、整体架构、技术决策、行动计划、风险关注点。
3. 行动项只保留真正需要推进的任务，会议日期、会议主题、章节标题不能进入行动项。
4. 长图所需的 milestones、risk_cards、key_actions、chapters 必须精炼、准确、可展示。
5. 空白或无意义模块不要输出；如果某类内容原文没有明确材料，输出空数组。`
      }
    ]);

    const firstPass = parseMeetingMinutesJson(rawOutput);
    if (firstPass.success) {
      return {
        structuredJson: firstPass.data,
        rawOutput,
        repaired: false
      };
    }

    const repairedOutput = await this.repairJson(config, {
      rawOutput,
      schemaErrors: formatZodError(firstPass.error)
    });
    const repaired = parseMeetingMinutesJson(repairedOutput);

    if (!repaired.success) {
      throw new Error(`模型质量修订输出无法修复为合法 MeetingMinutesJson：${formatZodError(repaired.error)}`);
    }

    return {
      structuredJson: repaired.data,
      rawOutput: repairedOutput,
      repaired: true
    };
  }

  async repairJson(config: LlmAdapterConfig, input: RepairJsonInput): Promise<string> {
    return this.chat(config, [
      { role: "system", content: "你是 JSON 修复器。只输出修复后的合法 JSON，不输出解释。" },
      {
        role: "user",
        content: `下面的模型输出不是合法 JSON，或不符合指定 Schema。
请在不新增事实、不改写事实含义的前提下，将其修复为合法 JSON。
只输出修复后的 JSON。

Schema 错误：
${input.schemaErrors}

目标 JSON 结构：
${MEETING_MINUTES_JSON_SKELETON}

原始输出：
${input.rawOutput}`
      }
    ]);
  }

  async syncMinutesJsonFromMarkdown(
    config: LlmAdapterConfig,
    input: SyncMinutesJsonFromMarkdownInput
  ): Promise<GenerateMinutesResult> {
    const rawOutput = await this.chat(config, [
      {
        role: "system",
        content: `你是企业会议纪要结构化助手。

你的任务是把用户编辑后的 Markdown 会议纪要转换为合法 MeetingMinutesJson。

要求：
1. 只输出合法 JSON，不输出 Markdown，不输出解释。
2. 以用户编辑后的 Markdown 为最高优先级。
3. previousStructuredJson 只能用于补齐结构、字段和缺失上下文，不得覆盖 Markdown 中用户明确修改的内容。
4. 不得编造 Markdown 和 previousStructuredJson 都没有的信息。
5. owner、due_date 缺失时填“待定”。
6. action_items.status 只能是：待推进、进行中、已完成、阻塞、待定。
7. decisions.type 只能是：已确认、待验证、风险提示。
8. risk level 只能是：高、中、低。
9. 顶层必须是一个 JSON object。

JSON 结构：
${MEETING_MINUTES_JSON_SKELETON}`
      },
      {
        role: "user",
        content: `会议类型：${input.meeting.meetingType}
会议主题：${input.meeting.title}
会议开始时间：${input.meeting.startTime ?? "待定"}
会议结束时间：${input.meeting.endTime ?? "待定"}
参会人：${input.meeting.participants.join("、") || "待定"}

用户编辑后的 Markdown：
${input.markdownContent}

previousStructuredJson：
${JSON.stringify(input.previousStructuredJson, null, 2)}

请输出同步后的 MeetingMinutesJson。`
      }
    ]);

    const firstPass = parseMeetingMinutesJson(rawOutput);
    if (firstPass.success) {
      return {
        structuredJson: firstPass.data,
        rawOutput,
        repaired: false
      };
    }

    const repairedOutput = await this.repairJson(config, {
      rawOutput,
      schemaErrors: formatZodError(firstPass.error)
    });
    const repaired = parseMeetingMinutesJson(repairedOutput);
    if (!repaired.success) {
      throw new Error(`Markdown 同步结构化 JSON 失败：${formatZodError(repaired.error)}`);
    }

    return {
      structuredJson: repaired.data,
      rawOutput: repairedOutput,
      repaired: true
    };
  }

  private async chat(config: LlmAdapterConfig, messages: ChatMessage[]) {
    if (!config.baseUrl || !config.model) {
      throw new LlmAdapterNotConfiguredError(config.provider);
    }

    const endpoint = buildChatCompletionsEndpoint(config.baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(config.apiKeyEncrypted ? { authorization: `Bearer ${config.apiKeyEncrypted}` } : {})
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: config.temperature,
          max_tokens: config.maxTokens,
          ...(config.jsonMode ? { response_format: { type: "json_object" } } : {})
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`LLM request failed: ${response.status} ${response.statusText} ${errorText}`.trim());
      }

      const payload = (await response.json()) as ChatCompletionResponse;
      const message = payload.choices?.[0]?.message;
      const content = selectChatMessageText(message);
      if (!content) {
        throw new Error("LLM response did not contain choices[0].message.content or reasoning");
      }

      return content;
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(`LLM request timed out after ${config.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildChatCompletionsEndpoint(baseUrl: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /operation was aborted/i.test(error.message));
}

export class PlaceholderMeetingMinutesLlmAdapter extends OpenAiCompatibleMeetingMinutesLlmAdapter {}

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
    };
  }>;
};

function parseMeetingMinutesJson(rawOutput: string) {
  const candidates = extractJsonCandidates(rawOutput);
  let firstSchemaError: ZodError | null = null;
  let firstParseError: Error | null = null;

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const result = MeetingMinutesJsonSchema.safeParse(parsed);
      if (result.success) {
        return result;
      }
      firstSchemaError ??= result.error;
    } catch (error) {
      if (!firstParseError) {
        firstParseError = error instanceof Error ? error : new Error("JSON parse failed");
      }
    }
  }

  return {
    success: false as const,
    error:
      firstSchemaError ??
      new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: [],
          message: firstParseError?.message ?? "JSON parse failed"
        }
      ])
  };
}

function extractJsonCandidates(rawOutput: string) {
  const trimmed = rawOutput.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) {
    return [fenced[1].trim(), ...extractBalancedJsonObjects(fenced[1])];
  }

  const withoutThinking = stripThinkingBlocks(trimmed);
  const balanced = extractBalancedJsonObjects(withoutThinking);
  const rawBalanced = withoutThinking === trimmed ? [] : extractBalancedJsonObjects(trimmed);
  const candidates = [...balanced, ...rawBalanced];
  return candidates.length > 0 ? [...new Set(candidates)] : [withoutThinking || trimmed];
}

function stripThinkingBlocks(text: string) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function extractBalancedJsonObjects(text: string) {
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return [...new Set(candidates)];
}

function selectChatMessageText(message?: { content?: string | null; reasoning?: string | null; reasoning_content?: string | null }) {
  const content = message?.content?.trim();
  if (content) {
    return content;
  }

  const reasoning = message?.reasoning?.trim() || message?.reasoning_content?.trim();
  if (!reasoning) {
    return "";
  }

  const jsonCandidate = extractBalancedJsonObjects(stripThinkingBlocks(reasoning)).at(-1) ?? extractBalancedJsonObjects(reasoning).at(-1);
  return jsonCandidate ?? reasoning;
}

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("\n");
}
