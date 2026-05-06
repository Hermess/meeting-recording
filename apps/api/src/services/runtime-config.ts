import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DOUBAO_VOLCENGINE_ASR_DEFAULTS, type DoubaoVolcengineAsrConfig } from "@meeting-ai-kit/asr-adapter";
import { decryptSecret, encryptSecret } from "../security/secrets.js";
import { resolveStoragePath } from "../utils/paths.js";

type RuntimeConfigFile = {
  asr?: {
    enabled?: boolean;
    wsUrl?: string;
    appId?: string;
    accessTokenEncrypted?: string;
    secretKeyEncrypted?: string;
    resourceId?: string;
    replacementWordId?: string;
    connectId?: string;
    chunkMs?: 200;
    reconnectAttempts?: number;
  };
  feishu?: {
    enabled?: boolean;
    bin?: string;
    profile?: string;
    defaultFolder?: string;
    fakeMode?: boolean;
  };
  yuque?: {
    enabled?: boolean;
    apiBaseUrl?: string;
    tokenEncrypted?: string;
    accountLogin?: string;
    accountName?: string;
  };
  hotwords?: Array<{
    id: string;
    term: string;
    type: string;
  }>;
};

export type AsrPublicConfig = {
  provider: "doubao_volcengine_asr";
  enabled: boolean;
  wsUrl: string;
  appIdSet: boolean;
  accessTokenSet: boolean;
  secretKeySet: boolean;
  resourceId: string;
  replacementWordId: string;
  personalHotwords: string[];
  connectId: string;
  sampleRate: 16000;
  audioFormat: "pcm";
  chunkMs: 200;
  enablePunctuation: boolean;
  reconnectAttempts: number;
  docs: string;
};

export type UpsertAsrConfigInput = Partial<{
  enabled: boolean;
  wsUrl: string;
  appKey: string;
  accessKey: string;
  appId: string;
  accessToken: string;
  secretKey: string;
  resourceId: string;
  replacementWordId: string;
  connectId: string;
  reconnectAttempts: number;
}>;

export type FeishuPublicConfig = {
  writer: "lark_cli";
  enabled: boolean;
  bin: string;
  profile: string;
  defaultFolder: string;
  fakeMode: boolean;
};

export type UpsertFeishuConfigInput = Partial<{
  enabled: boolean;
  bin: string;
  profile: string;
  defaultFolder: string;
  fakeMode: boolean;
}>;

export type YuquePublicConfig = {
  enabled: boolean;
  apiBaseUrl: string;
  tokenSet: boolean;
  accountLogin?: string | undefined;
  accountName?: string | undefined;
};

export type UpsertYuqueConfigInput = Partial<{
  enabled: boolean;
  apiBaseUrl: string;
  token: string;
  accountLogin: string;
  accountName: string;
}>;

export type PersonalHotword = {
  id: string;
  term: string;
  type: string;
};

const GLOBAL_CONFIG_PATH = resolveStoragePath("config", "app-config.json");

export async function getAsrPublicConfig(ownerUserId?: string): Promise<AsrPublicConfig> {
  const file = await readRuntimeConfig(ownerUserId);
  const asr = file.asr ?? {};
  return {
    provider: "doubao_volcengine_asr",
    enabled: asr.enabled ?? process.env.DOUBAO_VOLCENGINE_ASR_ENABLED === "true",
    wsUrl: asr.wsUrl ?? process.env.DOUBAO_VOLCENGINE_ASR_WS_URL ?? DOUBAO_VOLCENGINE_ASR_DEFAULTS.wsUrl,
    appIdSet: Boolean(asr.appId || process.env.DOUBAO_VOLCENGINE_ASR_APP_ID || process.env.DOUBAO_VOLCENGINE_ASR_APP_KEY),
    accessTokenSet: Boolean(asr.accessTokenEncrypted || process.env.DOUBAO_VOLCENGINE_ASR_ACCESS_TOKEN || process.env.DOUBAO_VOLCENGINE_ASR_ACCESS_KEY),
    secretKeySet: Boolean(asr.secretKeyEncrypted || process.env.DOUBAO_VOLCENGINE_ASR_SECRET_KEY),
    resourceId: asr.resourceId ?? process.env.DOUBAO_VOLCENGINE_ASR_RESOURCE_ID ?? DOUBAO_VOLCENGINE_ASR_DEFAULTS.resourceId,
    replacementWordId: asr.replacementWordId ?? process.env.DOUBAO_VOLCENGINE_ASR_REPLACEMENT_WORD_ID ?? "",
    connectId: asr.connectId ?? process.env.DOUBAO_VOLCENGINE_ASR_CONNECT_ID ?? "",
    personalHotwords: (file.hotwords ?? []).map((item) => item.term.trim()).filter(Boolean),
    sampleRate: 16000,
    audioFormat: "pcm",
    chunkMs: 200,
    enablePunctuation: true,
    reconnectAttempts: asr.reconnectAttempts ?? Number(process.env.DOUBAO_VOLCENGINE_ASR_RECONNECT_ATTEMPTS ?? 2),
    docs: DOUBAO_VOLCENGINE_ASR_DEFAULTS.docs
  };
}

export async function buildAsrAdapterConfig(ownerUserId?: string): Promise<DoubaoVolcengineAsrConfig> {
  const file = await readRuntimeConfig(ownerUserId);
  const asr = file.asr ?? {};
  return {
    provider: "doubao_volcengine_asr",
    enabled: asr.enabled ?? process.env.DOUBAO_VOLCENGINE_ASR_ENABLED === "true",
    wsUrl: asr.wsUrl ?? process.env.DOUBAO_VOLCENGINE_ASR_WS_URL ?? DOUBAO_VOLCENGINE_ASR_DEFAULTS.wsUrl,
    appKey: asr.appId ?? process.env.DOUBAO_VOLCENGINE_ASR_APP_ID ?? process.env.DOUBAO_VOLCENGINE_ASR_APP_KEY ?? "",
    accessKey: asr.accessTokenEncrypted
      ? decryptSecret(asr.accessTokenEncrypted)
      : process.env.DOUBAO_VOLCENGINE_ASR_ACCESS_TOKEN ?? process.env.DOUBAO_VOLCENGINE_ASR_ACCESS_KEY ?? "",
    appId: asr.appId ?? process.env.DOUBAO_VOLCENGINE_ASR_APP_ID ?? "",
    accessToken: asr.accessTokenEncrypted ? decryptSecret(asr.accessTokenEncrypted) : process.env.DOUBAO_VOLCENGINE_ASR_ACCESS_TOKEN ?? "",
    secretKey: asr.secretKeyEncrypted ? decryptSecret(asr.secretKeyEncrypted) : process.env.DOUBAO_VOLCENGINE_ASR_SECRET_KEY ?? "",
    resourceId: asr.resourceId ?? process.env.DOUBAO_VOLCENGINE_ASR_RESOURCE_ID ?? DOUBAO_VOLCENGINE_ASR_DEFAULTS.resourceId,
    replacementWordId: asr.replacementWordId ?? process.env.DOUBAO_VOLCENGINE_ASR_REPLACEMENT_WORD_ID ?? "",
    connectId: asr.connectId ?? process.env.DOUBAO_VOLCENGINE_ASR_CONNECT_ID ?? "",
    personalHotwords: (file.hotwords ?? []).map((item) => item.term.trim()).filter(Boolean),
    sampleRate: 16000,
    audioFormat: "pcm",
    chunkMs: 200,
    enablePunctuation: true,
    reconnectAttempts: asr.reconnectAttempts ?? Number(process.env.DOUBAO_VOLCENGINE_ASR_RECONNECT_ATTEMPTS ?? 2)
  };
}

export async function updateAsrConfig(input: UpsertAsrConfigInput, ownerUserId?: string) {
  const config = await readRuntimeConfig(ownerUserId);
  const current = config.asr ?? {};
  config.asr = {
    ...current,
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.wsUrl !== undefined ? { wsUrl: input.wsUrl } : {}),
    ...(input.appId !== undefined || input.appKey !== undefined ? { appId: input.appId ?? input.appKey ?? "" } : {}),
    ...(input.accessToken !== undefined || input.accessKey !== undefined
      ? { accessTokenEncrypted: encryptSecret(input.accessToken ?? input.accessKey ?? "") }
      : {}),
    ...(input.secretKey !== undefined ? { secretKeyEncrypted: encryptSecret(input.secretKey) } : {}),
    ...(input.resourceId !== undefined ? { resourceId: input.resourceId } : {}),
    ...(input.replacementWordId !== undefined ? { replacementWordId: input.replacementWordId } : {}),
    ...(input.connectId !== undefined ? { connectId: input.connectId } : {}),
    ...(input.reconnectAttempts !== undefined ? { reconnectAttempts: input.reconnectAttempts } : {}),
    chunkMs: 200
  };
  await writeRuntimeConfig(config, ownerUserId);
  return getAsrPublicConfig(ownerUserId);
}

export async function getFeishuPublicConfig(ownerUserId?: string): Promise<FeishuPublicConfig> {
  const file = await readRuntimeConfig(ownerUserId);
  const feishu = file.feishu ?? {};
  return {
    writer: "lark_cli",
    enabled: feishu.enabled ?? process.env.FEISHU_CLI_ENABLED === "true",
    bin: feishu.bin ?? process.env.FEISHU_CLI_BIN ?? "lark",
    profile: feishu.profile ?? process.env.FEISHU_CLI_PROFILE ?? "default",
    defaultFolder: feishu.defaultFolder ?? process.env.FEISHU_DEFAULT_FOLDER ?? "",
    fakeMode: feishu.fakeMode ?? process.env.FEISHU_CLI_FAKE_MODE === "true"
  };
}

export async function updateFeishuConfig(input: UpsertFeishuConfigInput, ownerUserId?: string) {
  const config = await readRuntimeConfig(ownerUserId);
  config.feishu = {
    ...(config.feishu ?? {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.bin !== undefined ? { bin: input.bin } : {}),
    ...(input.profile !== undefined ? { profile: input.profile } : {}),
    ...(input.defaultFolder !== undefined ? { defaultFolder: input.defaultFolder } : {}),
    ...(input.fakeMode !== undefined ? { fakeMode: input.fakeMode } : {})
  };
  await writeRuntimeConfig(config, ownerUserId);
  return getFeishuPublicConfig(ownerUserId);
}

export async function getYuquePublicConfig(ownerUserId?: string): Promise<YuquePublicConfig> {
  const file = await readRuntimeConfig(ownerUserId);
  const yuque = file.yuque ?? {};
  return {
    enabled: yuque.enabled ?? Boolean(yuque.tokenEncrypted || process.env.YUQUE_TOKEN),
    apiBaseUrl: yuque.apiBaseUrl ?? process.env.YUQUE_API_BASE_URL ?? "https://www.yuque.com/api/v2",
    tokenSet: Boolean(yuque.tokenEncrypted || process.env.YUQUE_TOKEN),
    accountLogin: yuque.accountLogin,
    accountName: yuque.accountName
  };
}

export async function getYuquePrivateConfig(ownerUserId?: string) {
  const file = await readRuntimeConfig(ownerUserId);
  const yuque = file.yuque ?? {};
  return {
    enabled: yuque.enabled ?? Boolean(yuque.tokenEncrypted || process.env.YUQUE_TOKEN),
    apiBaseUrl: yuque.apiBaseUrl ?? process.env.YUQUE_API_BASE_URL ?? "https://www.yuque.com/api/v2",
    token: yuque.tokenEncrypted ? decryptSecret(yuque.tokenEncrypted) : process.env.YUQUE_TOKEN ?? "",
    accountLogin: yuque.accountLogin,
    accountName: yuque.accountName
  };
}

export async function updateYuqueConfig(input: UpsertYuqueConfigInput, ownerUserId?: string) {
  const config = await readRuntimeConfig(ownerUserId);
  config.yuque = {
    ...(config.yuque ?? {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.apiBaseUrl !== undefined ? { apiBaseUrl: input.apiBaseUrl } : {}),
    ...(input.token !== undefined ? { tokenEncrypted: encryptSecret(input.token) } : {}),
    ...(input.accountLogin !== undefined ? { accountLogin: input.accountLogin } : {}),
    ...(input.accountName !== undefined ? { accountName: input.accountName } : {})
  };
  await writeRuntimeConfig(config, ownerUserId);
  return getYuquePublicConfig(ownerUserId);
}

export async function getPersonalHotwords(ownerUserId?: string): Promise<PersonalHotword[]> {
  const file = await readRuntimeConfig(ownerUserId);
  return (file.hotwords ?? []).filter((item) => item.term.trim());
}

export async function updatePersonalHotwords(hotwords: Array<{ id?: string | undefined; term: string; type: string }>, ownerUserId?: string) {
  const config = await readRuntimeConfig(ownerUserId);
  config.hotwords = hotwords
    .map((item) => ({
      id: item.id || randomUUID(),
      term: item.term.trim(),
      type: item.type.trim() || "专业术语"
    }))
    .filter((item) => item.term);
  await writeRuntimeConfig(config, ownerUserId);
  return getPersonalHotwords(ownerUserId);
}

async function readRuntimeConfig(ownerUserId?: string): Promise<RuntimeConfigFile> {
  if (ownerUserId) {
    const userConfig = await readRuntimeConfigFile(configPathForOwner(ownerUserId));
    if (userConfig) {
      return userConfig;
    }
  }
  return (await readRuntimeConfigFile(GLOBAL_CONFIG_PATH)) ?? {};
}

async function readRuntimeConfigFile(filePath: string): Promise<RuntimeConfigFile | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as RuntimeConfigFile;
  } catch {
    return null;
  }
}

async function writeRuntimeConfig(config: RuntimeConfigFile, ownerUserId?: string) {
  const filePath = ownerUserId ? configPathForOwner(ownerUserId) : GLOBAL_CONFIG_PATH;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function configPathForOwner(ownerUserId: string) {
  return resolveStoragePath("config", "users", `${safeOwnerFileName(ownerUserId)}.json`);
}

function safeOwnerFileName(ownerUserId: string) {
  return ownerUserId.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80);
}
