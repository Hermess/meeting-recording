"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { apiDelete, apiGet, apiPatch, apiPost } from "../../lib/api";

type DefaultsResponse = {
  asr: AsrConfig;
  llmProviders: ProviderPreset[];
  visualTemplates: Array<{ id: string; name: string; width: number; scale: number }>;
  yuque: YuqueConfig;
  hotwords: PersonalHotword[];
};

type ProviderPreset = {
  id: string;
  name: string;
  baseUrl: string;
  defaultModel?: string;
  defaultApiKey?: string;
  defaultConfigName?: string;
};

type AsrConfig = {
  enabled: boolean;
  wsUrl: string;
  appIdSet: boolean;
  accessTokenSet: boolean;
  secretKeySet: boolean;
  resourceId: string;
  replacementWordId: string;
  reconnectAttempts: number;
};

type YuqueConfig = {
  enabled: boolean;
  apiBaseUrl: string;
  tokenSet: boolean;
  accountLogin?: string;
  accountName?: string;
};

type YuqueRepo = {
  id: number;
  name: string;
  slug: string;
  namespace: string;
  description?: string;
};

type PersonalHotword = {
  id: string;
  term: string;
  type: string;
};

type ModelConfigRow = {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  isDefault?: boolean;
  apiKeySet?: boolean;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
  retryCount?: number;
};

type TabKey = "account" | "models" | "asr" | "yuque" | "hotwords";
type ModalKind = "model" | "asr" | "yuque" | "hotwords" | null;

const tabs: Array<{ key: TabKey; label: string; desc: string }> = [
  { key: "account", label: "账号安全", desc: "邮箱登录与个人数据说明" },
  { key: "models", label: "模型网关", desc: "配置可用纪要模型，选择默认模型" },
  { key: "asr", label: "语音识别", desc: "豆包/火山实时 ASR 鉴权参数" },
  { key: "yuque", label: "语雀发布", desc: "Token、账号、知识库读取测试" },
  { key: "hotwords", label: "个人热词", desc: "人名、项目名、系统名、专业术语" }
];

const defaultModelForm = {
  id: "",
  name: "MiniMax 纪要模型",
  provider: "minimax",
  baseUrl: "https://api.minimax.chat/v1/text/chatcompletion_v2",
  apiKey: "",
  model: "MiniMax-M2.7",
  temperature: "0.1",
  maxTokens: "12000",
  timeoutMs: "240000",
  retryCount: "1",
  enabled: true,
  isDefault: true
};

const defaultAsrForm = {
  enabled: true,
  wsUrl: "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async",
  appId: "",
  accessToken: "",
  secretKey: "",
  resourceId: "volc.seedasr.sauc.duration",
  replacementWordId: "",
  reconnectAttempts: "2"
};

const defaultYuqueForm = {
  enabled: true,
  apiBaseUrl: "https://www.yuque.com/api/v2",
  token: "",
  accountLogin: "",
  accountName: ""
};

const hotwordTypes = ["人名", "项目名", "系统名", "专业术语"];

export function SettingsClient() {
  const [activeTab, setActiveTab] = useState<TabKey>("models");
  const [defaults, setDefaults] = useState<DefaultsResponse | null>(null);
  const [models, setModels] = useState<ModelConfigRow[]>([]);
  const [modal, setModal] = useState<ModalKind>(null);
  const [modelForm, setModelForm] = useState(defaultModelForm);
  const [asrForm, setAsrForm] = useState(defaultAsrForm);
  const [yuqueForm, setYuqueForm] = useState(defaultYuqueForm);
  const [hotwords, setHotwords] = useState<PersonalHotword[]>([]);
  const [yuqueRepos, setYuqueRepos] = useState<YuqueRepo[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [tested, setTested] = useState<Record<string, boolean>>({});
  const [isTestingModel, setIsTestingModel] = useState(false);
  const [modelTestMessage, setModelTestMessage] = useState<{ tone: "info" | "success" | "error"; text: string } | null>(null);

  const defaultModel = useMemo(() => models.find((model) => model.isDefault) ?? null, [models]);

  async function refresh() {
    const [defaultsResult, modelsResult] = await Promise.all([
      apiGet<DefaultsResponse>("/api/config/defaults"),
      apiGet<ModelConfigRow[]>("/api/config/models")
    ]);

    setDefaults(defaultsResult.data ?? null);
    setModels(modelsResult.data ?? []);
    setHotwords(defaultsResult.data?.hotwords ?? []);

    if (defaultsResult.data?.asr) {
      setAsrForm((current) => ({
        ...current,
        enabled: defaultsResult.data!.asr.enabled,
        wsUrl: defaultsResult.data!.asr.wsUrl,
        resourceId: defaultsResult.data!.asr.resourceId,
        replacementWordId: defaultsResult.data!.asr.replacementWordId,
        reconnectAttempts: String(defaultsResult.data!.asr.reconnectAttempts)
      }));
    }

    if (defaultsResult.data?.yuque) {
      setYuqueForm((current) => ({
        ...current,
        enabled: defaultsResult.data!.yuque.enabled,
        apiBaseUrl: defaultsResult.data!.yuque.apiBaseUrl,
        accountLogin: defaultsResult.data!.yuque.accountLogin ?? "",
        accountName: defaultsResult.data!.yuque.accountName ?? ""
      }));
    }

    if (defaultsResult.error || modelsResult.error) {
      setMessage(defaultsResult.error || modelsResult.error || "配置加载失败");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function openModelModal(model?: ModelConfigRow) {
    setModelForm(
      model
        ? {
            id: model.id,
            name: model.name,
            provider: model.provider,
            baseUrl: model.baseUrl,
            apiKey: "",
            model: model.model,
            temperature: String(model.temperature ?? 0.1),
            maxTokens: String(model.maxTokens ?? 12000),
            timeoutMs: String(model.timeoutMs ?? 240000),
            retryCount: String(model.retryCount ?? 1),
            enabled: model.enabled,
            isDefault: Boolean(model.isDefault)
          }
        : defaultModelForm
    );
    setTested((current) => ({ ...current, model: false }));
    setModelTestMessage(null);
    setModal("model");
  }

  function openModelPreset(provider: ProviderPreset) {
    setModelForm({
      ...defaultModelForm,
      provider: provider.id,
      name: provider.defaultConfigName ?? (provider.id === "model_gateway" ? "模型网关配置" : `${provider.name} 纪要模型`),
      baseUrl: provider.baseUrl,
      apiKey: provider.defaultApiKey ?? "",
      model: provider.defaultModel ?? defaultModelForProvider(provider.id),
      isDefault: models.length === 0
    });
    setTested((current) => ({ ...current, model: false }));
    setModelTestMessage(null);
    setModal("model");
  }

  function updateModelForm(patch: Partial<typeof defaultModelForm>) {
    setModelForm((current) => ({ ...current, ...patch }));
    setTested((current) => ({ ...current, model: false }));
    setModelTestMessage(null);
  }

  function validateModelFormForTest() {
    if (!modelForm.name.trim()) return "请填写配置名称，配置名称用于新建会议时选择纪要模型。";
    if (!modelForm.provider.trim()) return "请填写供应商 / 网关类型。";
    if (!modelForm.baseUrl.trim()) return "请填写模型网关 URL。";
    try {
      new URL(modelForm.baseUrl);
    } catch {
      return "模型网关 URL 格式不正确，请填写完整地址，例如 https://api.example.com/v1。";
    }
    if (!modelForm.model.trim()) return "请填写模型名称，也就是网关实际接收的 model 字段。";
    const editingModel = models.find((model) => model.id === modelForm.id);
    const providerNeedsKey = modelForm.provider !== "ollama";
    if (providerNeedsKey && !modelForm.apiKey.trim() && !editingModel?.apiKeySet) {
      return "请填写 API Key / AK。已有配置如果密钥已保存，可以留空测试；新增配置必须填写。";
    }
    for (const [label, value] of [
      ["Temperature", modelForm.temperature],
      ["Max Tokens", modelForm.maxTokens],
      ["Timeout(ms)", modelForm.timeoutMs],
      ["Retry Count", modelForm.retryCount]
    ] as const) {
      if (!Number.isFinite(Number(value))) {
        return `${label} 必须是数字。`;
      }
    }
    return null;
  }

  async function testDraftModel() {
    const validationError = validateModelFormForTest();
    if (validationError) {
      setTested((current) => ({ ...current, model: false }));
      setModelTestMessage({ tone: "error", text: validationError });
      setMessage(validationError);
      return;
    }

    const testingText = "正在测试模型网关，请稍候...";
    setIsTestingModel(true);
    setModelTestMessage({ tone: "info", text: testingText });
    setMessage(testingText);
    try {
      const result = modelForm.id
        ? await apiPost<{ ok: boolean; message: string }>(`/api/config/models/${modelForm.id}/test`, modelPayload())
        : await apiPost<{ ok: boolean; message: string }>("/api/config/models/test-draft", modelPayload());
      const ok = Boolean(result.data?.ok);
      const text = result.data?.message ?? result.error ?? "模型网关测试失败";
      setTested((current) => ({ ...current, model: ok }));
      setModelTestMessage({ tone: ok ? "success" : "error", text });
      setMessage(text);
    } finally {
      setIsTestingModel(false);
    }
  }

  async function saveModel() {
    if (!tested.model) {
      setMessage("请先测试通过模型网关，再保存配置。");
      setModelTestMessage({ tone: "error", text: "请先测试通过模型网关，再保存配置。" });
      return;
    }
    const result = modelForm.id
      ? await apiPatch<ModelConfigRow>(`/api/config/models/${modelForm.id}`, modelPayload())
      : await apiPost<ModelConfigRow>("/api/config/models", modelPayload());
    if (result.error) {
      setMessage(result.error);
      setModelTestMessage({ tone: "error", text: result.error });
      return;
    }
    setMessage("模型配置已保存");
    setModal(null);
    await refresh();
  }

  async function deleteModel(id: string) {
    const result = await apiDelete(`/api/config/models/${id}`);
    setMessage(result.error ?? "模型配置已删除");
    await refresh();
  }

  async function setDefaultModel(id: string) {
    const result = await apiPatch<ModelConfigRow>(`/api/config/models/${id}`, { isDefault: true });
    setMessage(result.error ?? "默认纪要模型已更新");
    await refresh();
  }

  async function testAsrConfig() {
    setMessage("正在测试 ASR 配置...");
    const result = await apiPost<{ ok: boolean; message: string }>("/api/config/asr/test", asrPayload());
    setTested((current) => ({ ...current, asr: Boolean(result.data?.ok) }));
    setMessage(result.data?.message ?? result.error ?? "ASR 测试失败");
  }

  async function saveAsrConfig() {
    if (!tested.asr) {
      setMessage("请先测试通过 ASR 配置，再保存。");
      return;
    }
    const result = await apiPatch<AsrConfig>("/api/config/asr", asrPayload());
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setMessage("ASR 配置已保存");
    setModal(null);
    await refresh();
  }

  async function testYuqueConfig() {
    setMessage("正在测试语雀 Token，并读取团队知识库...");
    const result = await apiPost<{ ok: boolean; message: string; account?: { login: string; name: string }; repos?: YuqueRepo[] }>("/api/config/yuque/test", yuquePayload());
    setTested((current) => ({ ...current, yuque: Boolean(result.data?.ok) }));
    if (result.data?.account) {
      setYuqueForm((current) => ({
        ...current,
        accountLogin: result.data!.account!.login,
        accountName: result.data!.account!.name
      }));
    }
    setYuqueRepos(result.data?.repos ?? []);
    setMessage(result.data?.message ?? result.error ?? "语雀测试失败");
  }

  async function saveYuqueConfig() {
    if (!tested.yuque) {
      setMessage("请先测试通过语雀 Token，再保存。");
      return;
    }
    const result = await apiPatch<YuqueConfig>("/api/config/yuque", yuquePayload());
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setMessage("语雀配置已保存");
    setModal(null);
    await refresh();
  }

  async function saveHotwords() {
    const cleaned = hotwords
      .map((item) => ({ ...item, term: item.term.trim(), type: item.type || "专业术语" }))
      .filter((item) => item.term);
    const result = await apiPatch<PersonalHotword[]>("/api/config/hotwords", { hotwords: cleaned });
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setHotwords(result.data ?? []);
    setMessage(`个人热词已保存，共 ${result.data?.length ?? 0} 个。`);
    setModal(null);
    await refresh();
  }

  function modelPayload() {
    const payload: Record<string, string | number | boolean> = {
      name: modelForm.name,
      provider: modelForm.provider,
      baseUrl: modelForm.baseUrl,
      model: modelForm.model,
      temperature: Number(modelForm.temperature || 0.1),
      maxTokens: Number(modelForm.maxTokens || 12000),
      jsonMode: true,
      timeoutMs: Number(modelForm.timeoutMs || 240000),
      retryCount: Number(modelForm.retryCount || 1),
      enabled: modelForm.enabled,
      isDefault: modelForm.isDefault
    };
    if (modelForm.apiKey) {
      payload.apiKey = modelForm.apiKey;
    }
    return payload;
  }

  function asrPayload() {
    return {
      enabled: asrForm.enabled,
      wsUrl: asrForm.wsUrl,
      appId: asrForm.appId || undefined,
      accessToken: asrForm.accessToken || undefined,
      secretKey: asrForm.secretKey || undefined,
      resourceId: asrForm.resourceId,
      replacementWordId: asrForm.replacementWordId,
      reconnectAttempts: Number(asrForm.reconnectAttempts || 2)
    };
  }

  function yuquePayload() {
    const payload: Record<string, string | boolean> = {
      enabled: yuqueForm.enabled,
      apiBaseUrl: yuqueForm.apiBaseUrl,
      accountLogin: yuqueForm.accountLogin,
      accountName: yuqueForm.accountName
    };
    if (yuqueForm.token) {
      payload.token = yuqueForm.token;
    }
    return payload;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="workspace-panel p-3">
        {tabs.map((tab) => (
          <button
            className={`block w-full rounded-lg px-4 py-3 text-left ${activeTab === tab.key ? "bg-blue-50 text-blue-700" : "text-ink hover:bg-slate-50"}`}
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            type="button"
          >
            <span className="block text-sm font-semibold">{tab.label}</span>
            <span className="mt-1 block text-xs leading-5 text-muted">{tab.desc}</span>
          </button>
        ))}
      </aside>

      <section className="workspace-panel p-6">
        {message ? <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</p> : null}
        {activeTab === "account" ? (
          <SettingsSection
            title="账号安全"
            action={null}
            desc="会议、模型网关配置、ASR 参数、语雀 Token 和个人热词都按当前登录邮箱隔离。"
          >
            <div className="rounded-lg border border-line bg-slate-50 p-4 text-sm leading-7 text-muted">
              <p>登录方式：邮箱 + 密码。</p>
              <p>注册与找回密码：通过邮箱验证码完成。</p>
              <p>数据范围：仅可查看和处理自己创建的会议与个人配置。</p>
              <p>密码保存：服务端仅保存不可逆哈希，不保存明文密码。</p>
            </div>
          </SettingsSection>
        ) : null}

        {activeTab === "models" ? (
          <SettingsSection
            title="模型网关配置库"
            desc="新增或编辑配置时必须先测试通过。新建会议默认使用这里标记为默认的纪要模型。"
            action={<button className="btn-primary" onClick={() => openModelModal()} type="button">新增模型</button>}
          >
            <div className="mb-5 grid gap-3 md:grid-cols-3">
              {(defaults?.llmProviders ?? []).map((provider) => (
                <button className="rounded-lg border border-line p-3 text-left hover:bg-slate-50" key={provider.id} onClick={() => openModelPreset(provider)} type="button">
                  <p className="text-sm font-semibold text-ink">{provider.name}</p>
                  <p className="mt-1 break-all text-xs text-muted">{provider.baseUrl}</p>
                </button>
              ))}
            </div>
            <ConfigList
              empty="暂无模型网关配置"
              items={models.map((model) => ({
                id: model.id,
                title: model.name,
                badge: model.isDefault ? "默认" : model.enabled ? "启用" : "停用",
                meta: `${model.provider} / ${model.model} / ${model.apiKeySet ? "AK 已保存" : "未保存 AK"}`,
                actions: (
                  <>
                    {!model.isDefault ? <button className="list-action" onClick={() => void setDefaultModel(model.id)} type="button">设为默认</button> : null}
                    <button className="list-action" onClick={() => openModelModal(model)} type="button">编辑</button>
                    <button className="list-action danger" onClick={() => void deleteModel(model.id)} type="button">删除</button>
                  </>
                )
              }))}
            />
          </SettingsSection>
        ) : null}

        {activeTab === "asr" ? (
          <SettingsSection
            title="语音识别配置"
            desc="每个账号自己配置豆包/火山 ASR 的 APP ID、Access Token 和 Secret Key。"
            action={<button className="btn-primary" onClick={() => setModal("asr")} type="button">编辑 ASR</button>}
          >
            <ConfigList
              empty="暂无 ASR 配置"
              items={[
                {
                  id: "asr",
                  title: "豆包/火山流式语音识别",
                  badge: defaults?.asr.enabled ? "启用" : "停用",
                  meta: `APP ID：${defaults?.asr.appIdSet ? "已保存" : "未保存"} / Access Token：${defaults?.asr.accessTokenSet ? "已保存" : "未保存"} / Secret Key：${defaults?.asr.secretKeySet ? "已保存" : "未保存"}`,
                  actions: <button className="list-action" onClick={() => setModal("asr")} type="button">配置</button>
                }
              ]}
            />
          </SettingsSection>
        ) : null}

        {activeTab === "yuque" ? (
          <SettingsSection
            title="语雀发布配置"
            desc="Token 测试通过后才能保存；发布时会读取你的知识库列表。"
            action={<button className="btn-primary" onClick={() => setModal("yuque")} type="button">配置语雀</button>}
          >
            <ConfigList
              empty="暂无语雀配置"
              items={[
                {
                  id: "yuque",
                  title: defaults?.yuque.accountName || "语雀账号",
                  badge: defaults?.yuque.enabled ? "启用" : "停用",
                  meta: `Token：${defaults?.yuque.tokenSet ? "已保存" : "未保存"} / API：${defaults?.yuque.apiBaseUrl ?? "-"}`,
                  actions: <button className="list-action" onClick={() => setModal("yuque")} type="button">配置</button>
                }
              ]}
            />
          </SettingsSection>
        ) : null}

        {activeTab === "hotwords" ? (
          <SettingsSection
            title="个人热词"
            desc="热词会用于语音识别和纪要生成，不限制数量。"
            action={<button className="btn-primary" onClick={() => setModal("hotwords")} type="button">管理热词</button>}
          >
            <ConfigList
              empty="暂无个人热词"
              items={hotwords.map((item) => ({
                id: item.id,
                title: item.term,
                badge: item.type,
                meta: "用于 ASR 热词与纪要模型提示",
                actions: null
              }))}
            />
          </SettingsSection>
        ) : null}
      </section>

      {modal === "model" ? (
        <Modal title={modelForm.id ? "编辑模型网关配置" : "新增模型网关配置"} onClose={() => setModal(null)}>
          <div className="grid gap-3">
            <TextField helper="配置名称给业务人员选择，例如“默认纪要模型”。模型名称才是实际 model 字段。" label="配置名称" value={modelForm.name} onChange={(name) => updateModelForm({ name })} />
            <TextField label="供应商 / 网关类型" value={modelForm.provider} onChange={(provider) => updateModelForm({ provider })} />
            <TextField label="模型网关 URL" value={modelForm.baseUrl} onChange={(baseUrl) => updateModelForm({ baseUrl })} />
            <TextField label="模型名称" value={modelForm.model} onChange={(model) => updateModelForm({ model })} />
            <TextField
              {...(modelForm.id ? { helper: "留空表示沿用已保存 AK；测试时会用当前表单参数加已保存 AK 联通。" } : {})}
              label="API Key / AK"
              type="password"
              value={modelForm.apiKey}
              onChange={(apiKey) => updateModelForm({ apiKey })}
            />
            <div className="grid gap-3 md:grid-cols-3">
              <TextField label="Temperature" value={modelForm.temperature} onChange={(temperature) => updateModelForm({ temperature })} />
              <TextField label="Max Tokens" value={modelForm.maxTokens} onChange={(maxTokens) => updateModelForm({ maxTokens })} />
              <TextField label="Timeout(ms)" value={modelForm.timeoutMs} onChange={(timeoutMs) => updateModelForm({ timeoutMs })} />
            </div>
            <CheckboxField label="启用此模型配置" checked={modelForm.enabled} onChange={(enabled) => updateModelForm({ enabled })} />
            <CheckboxField label="设为默认纪要模型" checked={modelForm.isDefault} onChange={(isDefault) => updateModelForm({ isDefault })} />
            {modelTestMessage ? <ModalNotice text={modelTestMessage.text} tone={modelTestMessage.tone} /> : null}
            <ModalActions canSave={Boolean(tested.model)} isTesting={isTestingModel} onSave={() => void saveModel()} onTest={() => void testDraftModel()} saveLabel="保存模型" testLabel="测试模型" />
          </div>
        </Modal>
      ) : null}

      {modal === "asr" ? (
        <Modal title="配置豆包/火山 ASR" onClose={() => setModal(null)}>
          <div className="grid gap-3">
            <CheckboxField label="启用实时 ASR" checked={asrForm.enabled} onChange={(enabled) => setAsrForm((current) => ({ ...current, enabled }))} />
            <TextField label="WebSocket URL" value={asrForm.wsUrl} onChange={(wsUrl) => setAsrForm((current) => ({ ...current, wsUrl }))} />
            <div className="grid gap-3 md:grid-cols-3">
              <TextField label="APP ID" type="password" value={asrForm.appId} onChange={(appId) => setAsrForm((current) => ({ ...current, appId }))} />
              <TextField label="Access Token" type="password" value={asrForm.accessToken} onChange={(accessToken) => setAsrForm((current) => ({ ...current, accessToken }))} />
              <TextField label="Secret Key" type="password" value={asrForm.secretKey} onChange={(secretKey) => setAsrForm((current) => ({ ...current, secretKey }))} />
            </div>
            <TextField label="Resource ID" value={asrForm.resourceId} onChange={(resourceId) => setAsrForm((current) => ({ ...current, resourceId }))} />
            <TextField label="替换词 ID" value={asrForm.replacementWordId} onChange={(replacementWordId) => setAsrForm((current) => ({ ...current, replacementWordId }))} />
            <TextField label="重连次数" value={asrForm.reconnectAttempts} onChange={(reconnectAttempts) => setAsrForm((current) => ({ ...current, reconnectAttempts }))} />
            <ModalActions canSave={Boolean(tested.asr)} onSave={() => void saveAsrConfig()} onTest={() => void testAsrConfig()} saveLabel="保存 ASR" testLabel="测试 ASR" />
          </div>
        </Modal>
      ) : null}

      {modal === "yuque" ? (
        <Modal title="配置语雀发布" onClose={() => setModal(null)}>
          <div className="grid gap-3">
            <CheckboxField label="启用语雀发布" checked={yuqueForm.enabled} onChange={(enabled) => setYuqueForm((current) => ({ ...current, enabled }))} />
            <TextField label="语雀 API 地址" value={yuqueForm.apiBaseUrl} onChange={(apiBaseUrl) => setYuqueForm((current) => ({ ...current, apiBaseUrl }))} />
            <TextField helper={defaults?.yuque.tokenSet ? "留空表示不覆盖已保存 Token。" : "请输入语雀个人 Token。"} label="语雀 Token" type="password" value={yuqueForm.token} onChange={(token) => setYuqueForm((current) => ({ ...current, token }))} />
            {yuqueForm.accountName ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">已连接账号：{yuqueForm.accountName}（{yuqueForm.accountLogin}）</p> : null}
            {yuqueRepos.length > 0 ? (
              <div className="max-h-48 overflow-auto rounded-md border border-line">
                {yuqueRepos.map((repo) => (
                  <p className="border-b border-line px-3 py-2 text-sm last:border-b-0" key={repo.namespace}>
                    <span className="font-semibold text-ink">{repo.name}</span>
                    <span className="ml-2 text-muted">{repo.namespace}</span>
                  </p>
                ))}
              </div>
            ) : null}
            <ModalActions canSave={Boolean(tested.yuque)} onSave={() => void saveYuqueConfig()} onTest={() => void testYuqueConfig()} saveLabel="保存语雀" testLabel="测试并读取知识库" />
          </div>
        </Modal>
      ) : null}

      {modal === "hotwords" ? (
        <Modal title={`个人热词（${hotwords.length} 个）`} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <div className="space-y-2">
              {hotwords.map((item, index) => (
                <div className="grid gap-2 md:grid-cols-[1fr_180px_auto]" key={item.id}>
                  <TextField {...(index === 0 ? { label: "词汇" } : {})} value={item.term} onChange={(term) => setHotwords((current) => current.map((row) => (row.id === item.id ? { ...row, term } : row)))} />
                  <SelectField {...(index === 0 ? { label: "类型" } : {})} options={hotwordTypes.map((type) => ({ label: type, value: type }))} value={item.type} onChange={(type) => setHotwords((current) => current.map((row) => (row.id === item.id ? { ...row, type } : row)))} />
                  <button className="self-end rounded-md border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50" onClick={() => setHotwords((current) => current.filter((row) => row.id !== item.id))} type="button">删除</button>
                </div>
              ))}
            </div>
            <button className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-slate-50" onClick={() => setHotwords((current) => [...current, { id: `draft-${Date.now()}`, term: "", type: "人名" }])} type="button">+ 添加热词</button>
            <div className="flex justify-end">
              <button className="btn-primary" onClick={() => void saveHotwords()} type="button">保存热词</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function SettingsSection({ title, desc, action, children }: { title: string; desc: string; action: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold text-ink">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-muted">{desc}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function ConfigList({
  items,
  empty
}: {
  empty: string;
  items: Array<{ id: string; title: string; badge: string; meta: string; actions: ReactNode }>;
}) {
  if (items.length === 0) {
    return <p className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">{empty}</p>;
  }
  return (
    <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
      {items.map((item) => (
        <div className="flex flex-wrap items-center justify-between gap-4 bg-white px-4 py-4" key={item.id}>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-ink">{item.title}</p>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">{item.badge}</span>
            </div>
            <p className="mt-1 break-all text-sm text-muted">{item.meta}</p>
          </div>
          {item.actions ? <div className="flex flex-wrap gap-2">{item.actions}</div> : null}
        </div>
      ))}
    </div>
  );
}

function defaultModelForProvider(providerId: string) {
  const models: Record<string, string> = {
    model_gateway: "Qwen3.5-35B-A3B",
    minimax: "MiniMax-M2.7",
    openai: "gpt-4o-mini",
    deepseek: "deepseek-chat",
    qwen: "qwen-plus",
    doubao: "doubao-seed-1-6",
    zhipu: "glm-4-flash",
    kimi: "moonshot-v1-8k",
    siliconflow: "Qwen/Qwen2.5-72B-Instruct",
    openrouter: "openai/gpt-4o-mini",
    ollama: "qwen2.5",
    custom_gateway: "deepseek-v4-pro"
  };
  return models[providerId] ?? defaultModelForm.model;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[88vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-ink">{title}</h3>
          <button className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-slate-50" onClick={onClose} type="button">关闭</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalNotice({ tone, text }: { tone: "info" | "success" | "error"; text: string }) {
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "error"
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : "border-blue-200 bg-blue-50 text-blue-800";
  return <p className={`rounded-md border px-3 py-2 text-sm leading-6 ${toneClass}`}>{text}</p>;
}

function ModalActions({
  testLabel,
  saveLabel,
  canSave,
  isTesting = false,
  onTest,
  onSave
}: {
  testLabel: string;
  saveLabel: string;
  canSave: boolean;
  isTesting?: boolean;
  onTest: () => void;
  onSave: () => void;
}) {
  return (
    <div className="flex justify-end gap-3">
      <button className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60" disabled={isTesting} onClick={onTest} type="button">
        {isTesting ? "测试中..." : testLabel}
      </button>
      <button className="btn-primary disabled:opacity-50" disabled={!canSave} onClick={onSave} type="button">{saveLabel}</button>
    </div>
  );
}

function TextField({ label, value, helper, type = "text", onChange }: { label?: string; value: string; helper?: string; type?: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      {label ? <span className="text-sm font-medium text-ink">{label}</span> : null}
      <input className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" onChange={(event) => onChange(event.target.value)} type={type} value={value} />
      {helper ? <span className="mt-1 block text-xs leading-5 text-muted">{helper}</span> : null}
    </label>
  );
}

function SelectField({ label, value, options, onChange }: { label?: string; value: string; options: Array<{ label: string; value: string }>; onChange: (value: string) => void }) {
  return (
    <label className="block">
      {label ? <span className="text-sm font-medium text-ink">{label}</span> : null}
      <select className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      {label}
    </label>
  );
}
