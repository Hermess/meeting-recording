import { z } from "zod";

export const MeetingStatusSchema = z.enum([
  "draft",
  "recording",
  "recorded",
  "generating",
  "generated",
  "rendering",
  "ready_to_publish",
  "publishing",
  "published",
  "failed"
]);

export type MeetingStatus = z.infer<typeof MeetingStatusSchema>;

export const TranscriptProviderSchema = z.enum(["doubao_asr", "manual_paste"]);
export type TranscriptProvider = z.infer<typeof TranscriptProviderSchema>;

export const MeetingInputModeSchema = z.enum(["record", "upload"]);
export type MeetingInputMode = z.infer<typeof MeetingInputModeSchema>;

export const RecordingAssetSchema = z.object({
  id: z.string(),
  meetingId: z.string(),
  filename: z.string(),
  originalName: z.string().optional(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().optional(),
  storagePath: z.string(),
  publicUrl: z.string(),
  createdAt: z.string()
});

export type RecordingAsset = z.infer<typeof RecordingAssetSchema>;

export const RiskLevelSchema = z.enum(["高", "中", "低"]);
export const DecisionTypeSchema = z.enum(["已确认", "待验证", "风险提示"]);
export const MinutesActionStatusSchema = z.enum(["待推进", "进行中", "已完成", "阻塞", "待定"]);
export const ActionItemStatusSchema = z.enum(["pending", "in_progress", "done", "blocked", "unknown"]);

export const ModelProviderIdSchema = z.enum([
  "openai",
  "deepseek",
  "qwen",
  "doubao",
  "zhipu",
  "kimi",
  "minimax",
  "siliconflow",
  "openrouter",
  "ollama",
  "model_gateway",
  "custom_gateway"
]);

export type ModelProviderId = z.infer<typeof ModelProviderIdSchema>;

export const MeetingSchema = z.object({
  id: z.string(),
  ownerUserId: z.string().nullable().optional(),
  title: z.string(),
  meetingType: z.string(),
  inputMode: MeetingInputModeSchema.default("record"),
  projectName: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  status: MeetingStatusSchema,
  participants: z.array(z.string()),
  summaryModelConfigId: z.string(),
  visualTemplateId: z.string(),
  feishuFolder: z.string().optional(),
  feishuDocUrl: z.string().url().optional(),
  yuqueRepoNamespace: z.string().optional(),
  yuquePublicLevel: z.number().int().optional(),
  yuqueDocUrl: z.string().url().optional(),
  lastError: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type Meeting = z.infer<typeof MeetingSchema>;

export const CreateMeetingInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  meetingType: z.string().trim().min(1).default("general_meeting"),
  inputMode: MeetingInputModeSchema.default("record"),
  projectName: z.string().trim().optional(),
  participants: z.array(z.string().trim().min(1)).default([]),
  summaryModelConfigId: z.string().trim().optional(),
  visualTemplateId: z.string().trim().min(1).default("project_biweekly_v1"),
  feishuFolder: z.string().trim().optional(),
  yuqueRepoNamespace: z.string().trim().optional(),
  yuquePublicLevel: z.number().int().min(0).max(2).optional(),
  startNow: z.boolean().default(false)
});

export type CreateMeetingInput = z.infer<typeof CreateMeetingInputSchema>;

export const UpdateMeetingInputSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  meetingType: z.string().trim().min(1).optional(),
  inputMode: MeetingInputModeSchema.optional(),
  projectName: z.string().trim().nullable().optional(),
  startTime: z.string().datetime().nullable().optional(),
  endTime: z.string().datetime().nullable().optional(),
  status: MeetingStatusSchema.optional(),
  participants: z.array(z.string().trim().min(1)).optional(),
  summaryModelConfigId: z.string().trim().min(1).optional(),
  visualTemplateId: z.string().trim().min(1).optional(),
  feishuFolder: z.string().trim().nullable().optional(),
  feishuDocUrl: z.string().url().nullable().optional(),
  yuqueRepoNamespace: z.string().trim().nullable().optional(),
  yuquePublicLevel: z.number().int().min(0).max(2).nullable().optional(),
  yuqueDocUrl: z.string().url().nullable().optional(),
  lastError: z.string().nullable().optional()
});

export type UpdateMeetingInput = z.infer<typeof UpdateMeetingInputSchema>;

export const TranscriptSegmentSchema = z.object({
  id: z.string(),
  meetingId: z.string(),
  index: z.number().int().nonnegative(),
  speaker: z.string().optional(),
  startMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().nonnegative().optional(),
  text: z.string(),
  isFinal: z.boolean(),
  provider: TranscriptProviderSchema,
  rawPayload: z.unknown().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional()
});

export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const CreateTranscriptSegmentsInputSchema = z.union([
  z.object({
    provider: z.literal("manual_paste"),
    text: z.string().trim().min(1)
  }),
  z.object({
    provider: z.literal("doubao_asr").default("doubao_asr"),
    segments: z
      .array(
        z.object({
          speaker: z.string().optional(),
          startMs: z.number().int().nonnegative().optional(),
          endMs: z.number().int().nonnegative().optional(),
          text: z.string().trim().min(1),
          isFinal: z.boolean().default(true),
          rawPayload: z.unknown().optional()
        })
      )
      .min(1)
  })
]);

export type CreateTranscriptSegmentsInput = z.infer<typeof CreateTranscriptSegmentsInputSchema>;

export const UpdateTranscriptSegmentInputSchema = z.object({
  speaker: z.string().nullable().optional(),
  startMs: z.number().int().nonnegative().nullable().optional(),
  endMs: z.number().int().nonnegative().nullable().optional(),
  text: z.string().trim().min(1).optional(),
  isFinal: z.boolean().optional()
});

export type UpdateTranscriptSegmentInput = z.infer<typeof UpdateTranscriptSegmentInputSchema>;

export const MeetingMinutesJsonSchema = z.object({
  meeting_background: z.object({
    title: z.string(),
    topic: z.string(),
    time: z.string(),
    participants: z.array(z.string()),
    project: z.string().optional(),
    meeting_type: z.string()
  }),
  executive_summary: z.object({
    title: z.string(),
    subtitle: z.string(),
    one_sentence_conclusion: z.string(),
    summary_paragraph: z.string()
  }),
  visual_summary: z.object({
    milestones: z.array(
      z.object({
        date: z.string(),
        title: z.string(),
        bullets: z.array(z.string())
      })
    ),
    risk_cards: z.array(
      z.object({
        title: z.string(),
        level: RiskLevelSchema,
        description: z.string(),
        impact: z.string().optional(),
        suggestion: z.string().optional()
      })
    ),
    key_actions: z.array(
      z.object({
        title: z.string(),
        owner: z.string(),
        due_date: z.string(),
        status: z.string()
      })
    ),
    core_consensus: z.string()
  }),
  module_progress: z.array(
    z.object({
      module_name: z.string(),
      owner: z.string().optional(),
      current_status: z.string(),
      progress_items: z.array(z.string()),
      blockers: z.array(z.string()).optional(),
      next_steps: z.array(z.string()).optional()
    })
  ),
  decisions: z.array(
    z.object({
      decision: z.string(),
      type: DecisionTypeSchema,
      evidence_text: z.string().optional(),
      evidence_segment_ids: z.array(z.string()).optional()
    })
  ),
  action_items: z.array(
    z.object({
      action: z.string(),
      owner: z.string(),
      due_date: z.string(),
      status: MinutesActionStatusSchema,
      evidence_text: z.string().optional(),
      evidence_segment_ids: z.array(z.string()).optional()
    })
  ),
  ai_insights: z.array(
    z.object({
      title: z.string(),
      content: z.string(),
      risk_level: RiskLevelSchema.optional(),
      suggestion: z.string().optional()
    })
  ),
  todos: z.array(
    z.object({
      text: z.string(),
      checked: z.boolean()
    })
  ),
  chapters: z.array(
    z.object({
      start_time: z.string(),
      title: z.string(),
      summary: z.string()
    })
  )
});

export type MeetingMinutesJson = z.infer<typeof MeetingMinutesJsonSchema>;

export const FeishuDocBlockSchema = z.record(z.unknown());
export type FeishuDocBlock = z.infer<typeof FeishuDocBlockSchema>;

export const MeetingMinutesSchema = z.object({
  id: z.string(),
  meetingId: z.string(),
  rawTranscript: z.string(),
  structuredJson: MeetingMinutesJsonSchema,
  markdownContent: z.string(),
  feishuDocBlocks: z.array(FeishuDocBlockSchema),
  modelConfigId: z.string(),
  promptVersion: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type MeetingMinutes = z.infer<typeof MeetingMinutesSchema>;

export const VisualReportSchema = z.object({
  id: z.string(),
  meetingId: z.string(),
  templateId: z.string(),
  visualJson: MeetingMinutesJsonSchema,
  htmlPath: z.string().optional(),
  imagePath: z.string().optional(),
  imageUrl: z.string().optional(),
  width: z.number().int().positive(),
  scale: z.number().positive(),
  createdAt: z.string()
});

export type VisualReport = z.infer<typeof VisualReportSchema>;

export const ActionItemSchema = z.object({
  id: z.string(),
  meetingId: z.string(),
  action: z.string(),
  owner: z.string(),
  dueDate: z.string(),
  status: ActionItemStatusSchema,
  evidenceSegmentIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string().optional()
});

export type ActionItem = z.infer<typeof ActionItemSchema>;

export const ModelConfigSchema = z.object({
  id: z.string(),
  ownerUserId: z.string().nullable().optional(),
  name: z.string(),
  provider: ModelProviderIdSchema,
  baseUrl: z.string().url(),
  apiKeyEncrypted: z.string(),
  model: z.string(),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().positive(),
  jsonMode: z.boolean(),
  timeoutMs: z.number().int().positive(),
  retryCount: z.number().int().nonnegative(),
  enabled: z.boolean(),
  isDefault: z.boolean().default(false)
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const UpsertModelConfigInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  provider: ModelProviderIdSchema,
  baseUrl: z.string().trim().url(),
  apiKey: z.string().optional(),
  model: z.string().trim().min(1),
  temperature: z.number().min(0).max(2).default(0.1),
  maxTokens: z.number().int().positive().default(12000),
  jsonMode: z.boolean().default(true),
  timeoutMs: z.number().int().positive().default(240000),
  retryCount: z.number().int().nonnegative().default(1),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false)
});

export type UpsertModelConfigInput = z.infer<typeof UpsertModelConfigInputSchema>;

export const TestModelConfigInputSchema = UpsertModelConfigInputSchema;
export type TestModelConfigInput = z.infer<typeof TestModelConfigInputSchema>;

export const MeetingTypeConfigSchema = z.object({
  id: z.string(),
  ownerUserId: z.string().nullable().optional(),
  name: z.string(),
  key: z.string(),
  defaultSummaryModelConfigId: z.string(),
  defaultVisualTemplateId: z.string(),
  defaultFeishuFolder: z.string(),
  promptTemplateId: z.string(),
  enabled: z.boolean()
});

export type MeetingTypeConfig = z.infer<typeof MeetingTypeConfigSchema>;

export const UpsertMeetingTypeConfigInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  key: z.string().trim().min(1).max(80),
  defaultSummaryModelConfigId: z.string().trim().min(1),
  defaultVisualTemplateId: z.string().trim().min(1),
  defaultFeishuFolder: z.string().trim().min(1),
  promptTemplateId: z.string().trim().min(1),
  enabled: z.boolean().default(true)
});

export type UpsertMeetingTypeConfigInput = z.infer<typeof UpsertMeetingTypeConfigInputSchema>;

export const FeishuPublishLogSchema = z.object({
  id: z.string(),
  meetingId: z.string(),
  docTitle: z.string(),
  docUrl: z.string().url().optional(),
  status: z.enum(["pending", "success", "failed"]),
  errorMessage: z.string().optional(),
  cliCommandSummary: z.string().optional(),
  createdAt: z.string()
});

export type FeishuPublishLog = z.infer<typeof FeishuPublishLogSchema>;
