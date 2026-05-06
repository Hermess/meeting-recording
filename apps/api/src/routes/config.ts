import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  DOUBAO_VOLCENGINE_ASR_DEFAULTS,
  VolcengineStreamingAsrAdapter,
  type AsrAdapterEvent,
  type DoubaoVolcengineAsrConfig
} from "@meeting-ai-kit/asr-adapter";
import { ShellFeishuCliAdapter } from "@meeting-ai-kit/feishu-cli-adapter";
import { OpenAiCompatibleMeetingMinutesLlmAdapter, type LlmAdapterConfig } from "@meeting-ai-kit/llm-adapter";
import { LLM_PROVIDER_PRESETS } from "@meeting-ai-kit/llm-adapter";
import {
  UpsertModelConfigInputSchema,
  TestModelConfigInputSchema
} from "@meeting-ai-kit/shared";
import { prisma } from "../prisma.js";
import { decryptSecret, encryptSecret } from "../security/secrets.js";
import { requireAuthContext } from "../services/auth.js";
import {
  buildAsrAdapterConfig,
  getPersonalHotwords,
  type UpsertAsrConfigInput,
  type UpsertFeishuConfigInput,
  type UpsertYuqueConfigInput,
  getAsrPublicConfig,
  getFeishuPublicConfig,
  getYuquePrivateConfig,
  getYuquePublicConfig,
  updatePersonalHotwords,
  updateAsrConfig,
  updateFeishuConfig,
  updateYuqueConfig
} from "../services/runtime-config.js";
import { YuqueAdapter } from "../services/yuque.js";
import { sendNotFound, sendZodError } from "../utils/http.js";

const IdParamsSchema = z.object({
  id: z.string().min(1)
});

const UpsertAsrConfigSchema = z.object({
  enabled: z.boolean().optional(),
  wsUrl: z.string().url().optional(),
  appId: z.string().optional(),
  accessToken: z.string().optional(),
  secretKey: z.string().optional(),
  appKey: z.string().optional(),
  accessKey: z.string().optional(),
  ak: z.string().optional(),
  resourceId: z.string().min(1).optional(),
  replacementWordId: z.string().optional(),
  connectId: z.string().optional(),
  reconnectAttempts: z.number().int().nonnegative().optional()
});

const UpsertFeishuConfigSchema = z.object({
  enabled: z.boolean().optional(),
  bin: z.string().min(1).optional(),
  profile: z.string().min(1).optional(),
  defaultFolder: z.string().optional(),
  fakeMode: z.boolean().optional()
});

const UpsertYuqueConfigSchema = z.object({
  enabled: z.boolean().optional(),
  apiBaseUrl: z.string().url().optional(),
  token: z.string().optional(),
  accountLogin: z.string().optional(),
  accountName: z.string().optional()
});

const PersonalHotwordSchema = z.object({
  id: z.string().optional(),
  term: z.string().trim().min(1),
  type: z.string().trim().min(1).default("专业术语")
});

const UpsertHotwordsSchema = z.object({
  hotwords: z.array(PersonalHotwordSchema)
});

const TestAsrConfigSchema = UpsertAsrConfigSchema.extend({
  enabled: z.boolean().default(true),
  wsUrl: z.string().url()
});

export async function registerConfigRoutes(app: FastifyInstance) {
  app.get("/defaults", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) return;
    const ownerUserId = auth.user?.id;
    return {
      asr: await getAsrPublicConfig(ownerUserId),
      llmProviders: LLM_PROVIDER_PRESETS,
      visualTemplates: [
        {
          id: "project_biweekly_v1",
          name: "智能纪要总结长图",
          width: 1080,
          scale: 2
        }
      ],
      feishu: await getFeishuPublicConfig(ownerUserId),
      yuque: await getYuquePublicConfig(ownerUserId),
      hotwords: await getPersonalHotwords(ownerUserId)
    };
  });

  app.get("/asr", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) return;
    return { data: await getAsrPublicConfig(auth.user?.id) };
  });

  app.patch("/asr", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) return;
    const parsed = UpsertAsrConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendZodError(reply, parsed.error);
    }

    const input: UpsertAsrConfigInput = {};
    if (parsed.data.enabled !== undefined) input.enabled = parsed.data.enabled;
    if (parsed.data.wsUrl !== undefined) input.wsUrl = parsed.data.wsUrl;
    if (parsed.data.appId !== undefined || parsed.data.appKey !== undefined) {
      input.appId = parsed.data.appId ?? parsed.data.appKey ?? "";
    }
    if (parsed.data.accessToken !== undefined || parsed.data.accessKey !== undefined || parsed.data.ak !== undefined) {
      input.accessToken = parsed.data.accessToken ?? parsed.data.accessKey ?? parsed.data.ak ?? "";
    }
    if (parsed.data.secretKey !== undefined) input.secretKey = parsed.data.secretKey;
    if (parsed.data.resourceId !== undefined) input.resourceId = parsed.data.resourceId;
    if (parsed.data.replacementWordId !== undefined) input.replacementWordId = parsed.data.replacementWordId;
    if (parsed.data.connectId !== undefined) input.connectId = parsed.data.connectId;
    if (parsed.data.reconnectAttempts !== undefined) input.reconnectAttempts = parsed.data.reconnectAttempts;

    return {
      data: await updateAsrConfig(input, auth.user?.id)
    };
  });

  app.post("/asr/test", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) return;
    const body = TestAsrConfigSchema.partial().safeParse(request.body);
    const config = body.success && Object.keys(body.data).length > 0
      ? {
          ...(await buildAsrAdapterConfig(auth.user?.id)),
          enabled: body.data.enabled ?? true,
          ...(body.data.wsUrl !== undefined ? { wsUrl: body.data.wsUrl } : {}),
          ...(body.data.appId !== undefined ? { appId: body.data.appId, appKey: body.data.appId } : {}),
          ...(body.data.accessToken !== undefined ? { accessToken: body.data.accessToken, accessKey: body.data.accessToken } : {}),
          ...(body.data.secretKey !== undefined ? { secretKey: body.data.secretKey } : {}),
          ...(body.data.resourceId !== undefined ? { resourceId: body.data.resourceId } : {}),
          ...(body.data.replacementWordId !== undefined ? { replacementWordId: body.data.replacementWordId } : {}),
          ...(body.data.reconnectAttempts !== undefined ? { reconnectAttempts: body.data.reconnectAttempts } : {})
        }
      : await buildAsrAdapterConfig(auth.user?.id);
    const missing = [];
    if (!config.enabled) missing.push("enabled");
    if (!config.appId && !config.appKey) missing.push("APP ID");
    if (!config.accessToken && !config.accessKey) missing.push("Access Token");
    if (!config.secretKey) missing.push("Secret Key");
    if (missing.length > 0) {
      return {
        ok: false,
        code: "asr_not_configured",
        message: `豆包/火山 ASR 尚未就绪：${missing.join(", ")}。粘贴转写兜底仍可使用。`,
        docs: DOUBAO_VOLCENGINE_ASR_DEFAULTS.docs
      };
    }

    const result = await testAsrConnection(config);
    return {
      ok: result.ok,
      code: result.ok ? "asr_connect_ready" : "asr_connect_failed",
      message: result.message,
      docs: DOUBAO_VOLCENGINE_ASR_DEFAULTS.docs
    };
  });

  app.get("/feishu", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) return;
    return { data: await getFeishuPublicConfig(auth.user?.id) };
  });

  app.patch("/feishu", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) return;
    const parsed = UpsertFeishuConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendZodError(reply, parsed.error);
    }

    const input: UpsertFeishuConfigInput = {};
    if (parsed.data.enabled !== undefined) input.enabled = parsed.data.enabled;
    if (parsed.data.bin !== undefined) input.bin = parsed.data.bin;
    if (parsed.data.profile !== undefined) input.profile = parsed.data.profile;
    if (parsed.data.defaultFolder !== undefined) input.defaultFolder = parsed.data.defaultFolder;
    if (parsed.data.fakeMode !== undefined) input.fakeMode = parsed.data.fakeMode;

    return {
      data: await updateFeishuConfig(input, auth.user?.id)
    };
  });

  app.post("/feishu/test", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) return;
    const parsed = UpsertFeishuConfigSchema.partial().safeParse(request.body);
    const current = await getFeishuPublicConfig(auth.user?.id);
    const draft = parsed.success ? parsed.data : {};
    const config = {
      ...current,
      ...(draft.enabled !== undefined ? { enabled: draft.enabled } : {}),
      ...(draft.bin !== undefined ? { bin: draft.bin } : {}),
      ...(draft.profile !== undefined ? { profile: draft.profile } : {}),
      ...(draft.defaultFolder !== undefined ? { defaultFolder: draft.defaultFolder } : {}),
      ...(draft.fakeMode !== undefined ? { fakeMode: draft.fakeMode } : {})
    };
    if (config.fakeMode) {
      return {
        ok: true,
        code: "feishu_fake_mode",
        message: "飞书 CLI fake mode 已启用，发布链路可做本地冒烟。"
      };
    }

    const adapter = new ShellFeishuCliAdapter({
      enabled: config.enabled,
      bin: config.bin,
      profile: config.profile,
      defaultFolder: config.defaultFolder
    });
    const ok = await adapter.checkAuthStatus();
    return {
      ok,
      code: ok ? "feishu_cli_ready" : "feishu_cli_not_ready",
      message: ok ? "飞书 CLI 已登录。" : "飞书 CLI 未启用、未安装或未登录。"
    };
  });

  app.get("/yuque", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) return;
    return { data: await getYuquePublicConfig(auth.user?.id) };
  });

  app.patch("/yuque", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) return;
    const parsed = UpsertYuqueConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendZodError(reply, parsed.error);
    }

    const input: UpsertYuqueConfigInput = {};
    if (parsed.data.enabled !== undefined) input.enabled = parsed.data.enabled;
    if (parsed.data.apiBaseUrl !== undefined) input.apiBaseUrl = parsed.data.apiBaseUrl;
    if (parsed.data.token !== undefined) input.token = parsed.data.token;
    if (parsed.data.accountLogin !== undefined) input.accountLogin = parsed.data.accountLogin;
    if (parsed.data.accountName !== undefined) input.accountName = parsed.data.accountName;

    return {
      data: await updateYuqueConfig(input, auth.user?.id)
    };
  });

  app.post("/yuque/test", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) return;
    const parsed = UpsertYuqueConfigSchema.partial().safeParse(request.body);
    const current = await getYuquePrivateConfig(auth.user?.id);
    const draft = parsed.success ? parsed.data : {};
    const adapter = new YuqueAdapter({
      enabled: draft.enabled ?? current.enabled,
      apiBaseUrl: draft.apiBaseUrl ?? current.apiBaseUrl,
      token: draft.token ?? current.token
    });
    try {
      const user = await adapter.testConnection();
      const repos = await adapter.listRepos(user.login);
      return {
        ok: true,
        code: "yuque_ready",
        message: `语雀连接成功：${user.name}，已读取 ${repos.length} 个知识库。`,
        account: user,
        repos
      };
    } catch (error) {
      return {
        ok: false,
        code: "yuque_connect_failed",
        message: error instanceof Error ? error.message : "语雀连接失败。"
      };
    }
  });

  app.get("/yuque/repos", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) return;
    const config = await getYuquePrivateConfig(auth.user?.id);
    const adapter = new YuqueAdapter(config);
    const user = await adapter.testConnection();
    return {
      data: await adapter.listRepos(user.login)
    };
  });

  app.get("/hotwords", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) return;
    return { data: await getPersonalHotwords(auth.user?.id) };
  });

  app.patch("/hotwords", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) return;
    const parsed = UpsertHotwordsSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendZodError(reply, parsed.error);
    }

    return {
      data: await updatePersonalHotwords(parsed.data.hotwords, auth.user?.id)
    };
  });

  app.get("/models", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) return;
    await ensureOneDefaultModel(auth);
    const models = await prisma.modelConfig.findMany({
      where: scopedConfigWhere(auth),
      orderBy: [{ isDefault: "desc" }, { enabled: "desc" }, { updatedAt: "desc" }]
    });

    return {
      data: models.map((model) => ({
        ...model,
        apiKeyEncrypted: undefined,
        apiKeySet: Boolean(model.apiKeyEncrypted),
        createdAt: model.createdAt.toISOString(),
        updatedAt: model.updatedAt.toISOString()
      }))
    };
  });

  app.post("/models", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) return;
    const parsed = UpsertModelConfigInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendZodError(reply, parsed.error);
    }

    const created = await prisma.$transaction(async (tx) => {
      const shouldDefault = parsed.data.isDefault || (await tx.modelConfig.count({ where: scopedConfigWhere(auth) })) === 0;
      if (shouldDefault) {
        await tx.modelConfig.updateMany({ where: scopedConfigWhere(auth), data: { isDefault: false } });
      }
      return tx.modelConfig.create({
        data: {
          ownerUserId: auth.enabled && auth.user ? auth.user.id : null,
          name: parsed.data.name,
          provider: parsed.data.provider,
          baseUrl: parsed.data.baseUrl,
          apiKeyEncrypted: encryptSecret(parsed.data.apiKey ?? ""),
          model: parsed.data.model,
          temperature: parsed.data.temperature,
          maxTokens: parsed.data.maxTokens,
          jsonMode: parsed.data.jsonMode,
          timeoutMs: parsed.data.timeoutMs,
          retryCount: parsed.data.retryCount,
          enabled: parsed.data.enabled,
          isDefault: shouldDefault
        }
      });
    });

    return reply.code(201).send({
      data: {
        ...created,
        apiKeyEncrypted: undefined,
        apiKeySet: Boolean(created.apiKeyEncrypted),
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString()
      }
    });
  });

  app.patch("/models/:id", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) return;
    const params = IdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendZodError(reply, params.error);
    }

    const parsed = UpsertModelConfigInputSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return sendZodError(reply, parsed.error);
    }

    const updateData: Prisma.ModelConfigUpdateInput = {};
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.provider !== undefined) updateData.provider = parsed.data.provider;
    if (parsed.data.baseUrl !== undefined) updateData.baseUrl = parsed.data.baseUrl;
    if (parsed.data.apiKey !== undefined) updateData.apiKeyEncrypted = encryptSecret(parsed.data.apiKey);
    if (parsed.data.model !== undefined) updateData.model = parsed.data.model;
    if (parsed.data.temperature !== undefined) updateData.temperature = parsed.data.temperature;
    if (parsed.data.maxTokens !== undefined) updateData.maxTokens = parsed.data.maxTokens;
    if (parsed.data.jsonMode !== undefined) updateData.jsonMode = parsed.data.jsonMode;
    if (parsed.data.timeoutMs !== undefined) updateData.timeoutMs = parsed.data.timeoutMs;
    if (parsed.data.retryCount !== undefined) updateData.retryCount = parsed.data.retryCount;
    if (parsed.data.enabled !== undefined) updateData.enabled = parsed.data.enabled;
    if (parsed.data.isDefault !== undefined) updateData.isDefault = parsed.data.isDefault;

    const existing = await prisma.modelConfig.findFirst({
      where: scopedConfigWhere(auth, params.data.id),
      select: { id: true }
    });
    if (!existing) {
      return sendNotFound(reply, "Model config");
    }
    const updated = await prisma.$transaction(async (tx) => {
      if (parsed.data.isDefault === true) {
        await tx.modelConfig.updateMany({ where: scopedConfigWhere(auth), data: { isDefault: false } });
      }
      return tx.modelConfig.update({
        where: { id: existing.id },
        data: updateData
      });
    });

    return {
      data: {
        ...updated,
        apiKeyEncrypted: undefined,
        apiKeySet: Boolean(updated.apiKeyEncrypted),
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString()
      }
    };
  });

  app.post("/models/:id/test", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) return;
    const params = IdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendZodError(reply, params.error);
    }

    const model = await prisma.modelConfig.findFirst({
      where: scopedConfigWhere(auth, params.data.id)
    });
    if (!model) {
      return sendNotFound(reply, "Model config");
    }

    const adapter = new OpenAiCompatibleMeetingMinutesLlmAdapter();
    const result = await adapter.testConnection(toLlmConfig(model));
    return {
      ok: result.ok,
      message: result.message
    };
  });

  app.post("/models/test-draft", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) return;
    const parsed = TestModelConfigInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendZodError(reply, parsed.error);
    }

    const adapter = new OpenAiCompatibleMeetingMinutesLlmAdapter();
    const result = await adapter.testConnection({
      id: "draft",
      name: parsed.data.name,
      provider: parsed.data.provider,
      baseUrl: parsed.data.baseUrl,
      apiKeyEncrypted: parsed.data.apiKey ?? "",
      model: parsed.data.model,
      temperature: parsed.data.temperature,
      maxTokens: parsed.data.maxTokens,
      jsonMode: parsed.data.jsonMode,
      timeoutMs: parsed.data.timeoutMs,
      retryCount: parsed.data.retryCount,
      enabled: parsed.data.enabled,
      isDefault: Boolean(parsed.data.isDefault)
    });
    return {
      ok: result.ok,
      message: result.message
    };
  });

  app.delete("/models/:id", async (request, reply) => {
    const auth = await requireAuthContext(request, reply);
    if (!auth) return;
    const params = IdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendZodError(reply, params.error);
    }

    const existing = await prisma.modelConfig.findFirst({
      where: scopedConfigWhere(auth, params.data.id),
      select: { id: true, isDefault: true }
    });
    if (!existing) {
      return sendNotFound(reply, "Model config");
    }
    const deleted = await prisma.modelConfig.delete({ where: { id: existing.id } });
    if (existing.isDefault) {
      const latest = await prisma.modelConfig.findFirst({
        where: scopedConfigWhere(auth),
        orderBy: { updatedAt: "desc" }
      });
      if (latest) {
        await prisma.modelConfig.update({ where: { id: latest.id }, data: { isDefault: true } });
      }
    }

    return { data: { id: deleted.id } };
  });

}

function scopedConfigWhere(auth: { enabled: boolean; user: { id: string } | null }, id?: string): Prisma.ModelConfigWhereInput {
  return {
    ...(id ? { id } : {}),
    ...(auth.enabled && auth.user ? { ownerUserId: auth.user.id } : {})
  };
}

async function ensureOneDefaultModel(auth: { enabled: boolean; user: { id: string } | null }) {
  const where = scopedConfigWhere(auth);
  const defaults = await prisma.modelConfig.findMany({
    where: { ...where, isDefault: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true }
  });
  if (defaults.length > 1) {
    await prisma.modelConfig.updateMany({
      where: { ...where, id: { in: defaults.slice(1).map((item) => item.id) } },
      data: { isDefault: false }
    });
  }
  if (defaults.length > 0) {
    return;
  }
  const latest = await prisma.modelConfig.findFirst({
    where,
    orderBy: { updatedAt: "desc" },
    select: { id: true }
  });
  if (latest) {
    await prisma.modelConfig.update({ where: { id: latest.id }, data: { isDefault: true } });
  }
}

async function testAsrConnection(config: DoubaoVolcengineAsrConfig): Promise<{ ok: boolean; message: string }> {
  const adapter = new VolcengineStreamingAsrAdapter();
  const events: AsrAdapterEvent[] = [];
  let failure: string | undefined;
  const off = adapter.onEvent((event) => {
    events.push(event);
    if (event.type === "error") {
      failure = event.message;
    }
    if (event.type === "status" && event.status === "failed") {
      failure = event.message || "ASR 连接失败";
    }
  });

  try {
    await adapter.connect(config);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    if (failure) {
      return {
        ok: false,
        message: `豆包/火山 ASR 握手失败：${failure}`
      };
    }
    return {
      ok: true,
      message: "豆包/火山 ASR WebSocket 握手成功，实时转写可进入联调。"
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : failure ?? "未知连接错误";
    const status = events
      .filter((event) => event.type === "status")
      .map((event) => `${event.status}${event.message ? `: ${event.message}` : ""}`)
      .join("；");
    return {
      ok: false,
      message: `豆包/火山 ASR 未联通：${detail}${status ? `（${status}）` : ""}`
    };
  } finally {
    off();
    await adapter.close().catch(() => undefined);
  }
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
