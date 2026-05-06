"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost } from "../../../lib/api";

type MeetingResponse = {
  id: string;
  status: string;
};

type ModelConfigRow = {
  id: string;
  name: string;
  provider: string;
  model: string;
  enabled: boolean;
  isDefault?: boolean;
};

type YuqueRepo = {
  id: number;
  name: string;
  slug: string;
  namespace: string;
};

type DefaultsResponse = {
  visualTemplates: Array<{ id: string; name: string; width: number; scale: number }>;
};

type InputMode = "record" | "upload";

const defaultState = {
  title: "",
  inputMode: "record" as InputMode,
  participants: "",
  visualTemplateId: "project_biweekly_v1",
  yuqueRepoNamespace: "",
  yuquePublicLevel: "0"
};

export function NewMeetingForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const modeParam = searchParams.get("mode");
  const [form, setForm] = useState({
    ...defaultState,
    inputMode: modeParam === "upload" ? ("upload" as InputMode) : ("record" as InputMode)
  });
  const [models, setModels] = useState<ModelConfigRow[]>([]);
  const [visualTemplates, setVisualTemplates] = useState<DefaultsResponse["visualTemplates"]>([]);
  const [yuqueRepos, setYuqueRepos] = useState<YuqueRepo[]>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultModel = useMemo(() => {
    return models.find((model) => model.enabled && model.isDefault) ?? models.find((model) => model.enabled) ?? null;
  }, [models]);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      inputMode: modeParam === "upload" ? "upload" : "record"
    }));
  }, [modeParam]);

  useEffect(() => {
    async function loadOptions() {
      const [defaultsResult, modelsResult, yuqueReposResult] = await Promise.all([
        apiGet<DefaultsResponse>("/api/config/defaults"),
        apiGet<ModelConfigRow[]>("/api/config/models"),
        apiGet<YuqueRepo[]>("/api/config/yuque/repos")
      ]);
      const enabledModels = (modelsResult.data ?? []).filter((model) => model.enabled);
      const repos = yuqueReposResult.data ?? [];
      setModels(enabledModels);
      setVisualTemplates(defaultsResult.data?.visualTemplates ?? []);
      setYuqueRepos(repos);

      setForm((current) => ({
        ...current,
        visualTemplateId: defaultsResult.data?.visualTemplates?.some((template) => template.id === current.visualTemplateId)
          ? current.visualTemplateId
          : defaultsResult.data?.visualTemplates?.[0]?.id ?? current.visualTemplateId,
        yuqueRepoNamespace: current.yuqueRepoNamespace || repos[0]?.namespace || ""
      }));

      if (defaultsResult.error || modelsResult.error) {
        setError(defaultsResult.error || modelsResult.error || "配置加载失败");
      } else if (yuqueReposResult.error) {
        setError("语雀知识库暂未读取成功。你仍可先创建会议，稍后在纪要页选择发布位置。");
      }
      setIsLoadingOptions(false);
    }

    void loadOptions();
  }, []);

  async function submit(navigateToLive: boolean) {
    if (!form.title.trim()) {
      setError("请填写会议名称。");
      return;
    }
    if (!defaultModel) {
      setError("请先到设置页新增并测试通过一个模型网关配置，并设为默认纪要模型。");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const result = await apiPost<MeetingResponse>("/api/meetings", {
      title: form.title.trim(),
      inputMode: form.inputMode,
      meetingType: "general_meeting",
      projectName: "",
      summaryModelConfigId: defaultModel.id,
      visualTemplateId: form.visualTemplateId,
      yuqueRepoNamespace: form.yuqueRepoNamespace || undefined,
      yuquePublicLevel: Number(form.yuquePublicLevel),
      startNow: false,
      participants: form.participants
        .split(/[、,，\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
    });

    setIsSubmitting(false);

    if (result.error || !result.data) {
      setError(result.error ?? "创建会议失败");
      return;
    }

    router.push(navigateToLive ? `/meetings/${result.data.id}/live` : "/dashboard");
  }

  return (
    <section className="workspace-panel p-6">
      <div className="mb-6 grid gap-3 md:grid-cols-2">
        <ModeCard
          active={form.inputMode === "record"}
          description="现场开会时使用，进入后可手动开始、暂停和结束录音转写。"
          label="录音转写"
          onClick={() => setForm((current) => ({ ...current, inputMode: "record" }))}
        />
        <ModeCard
          active={form.inputMode === "upload"}
          description="已有材料时使用，创建后直接粘贴文本或上传 md、doc、docx、pdf。"
          label="上传 / 粘贴"
          onClick={() => setForm((current) => ({ ...current, inputMode: "upload" }))}
        />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <TextField label="会议名称" value={form.title} onChange={(title) => setForm((current) => ({ ...current, title }))} />
        <TextField
          helper="多个参会人用顿号、逗号或换行分隔。"
          label="参会人员"
          value={form.participants}
          onChange={(participants) => setForm((current) => ({ ...current, participants }))}
        />
        <ReadOnlyField
          helper="默认模型在设置页的模型网关配置库中管理，只能有一个默认项。"
          label="默认纪要模型"
          value={defaultModel ? `${defaultModel.name} · ${defaultModel.model}` : "未配置默认模型"}
        />
        <TextField
          label="总结图模板"
          value={form.visualTemplateId}
          onChange={(visualTemplateId) => setForm((current) => ({ ...current, visualTemplateId }))}
          options={visualTemplates.map((template) => ({
            label: `${template.name} · ${template.width}px`,
            value: template.id
          }))}
        />
        <TextField
          label="语雀知识库"
          helper={yuqueRepos.length > 0 ? "发布时默认进入这个知识库，纪要页仍可调整。" : "请先在设置页配置并测试语雀 Token。"}
          value={form.yuqueRepoNamespace}
          onChange={(yuqueRepoNamespace) => setForm((current) => ({ ...current, yuqueRepoNamespace }))}
          options={yuqueRepos.map((repo) => ({ label: `${repo.name} · ${repo.namespace}`, value: repo.namespace }))}
        />
        <TextField
          label="语雀公开级别"
          value={form.yuquePublicLevel}
          onChange={(yuquePublicLevel) => setForm((current) => ({ ...current, yuquePublicLevel }))}
          options={[
            { label: "继承知识库默认", value: "0" },
            { label: "公开", value: "1" },
            { label: "私密", value: "2" }
          ]}
        />
      </div>

      {error ? <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {!defaultModel && !isLoadingOptions ? (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          还没有默认纪要模型。请先到{" "}
          <Link className="font-semibold underline" href="/settings">
            设置页
          </Link>
          {" "}新增模型网关配置，测试通过并设为默认。
        </p>
      ) : null}

      <div className="mt-6 flex gap-3">
        <button
          className="btn-secondary disabled:opacity-50"
          disabled={isSubmitting || isLoadingOptions || !defaultModel}
          onClick={() => void submit(false)}
          type="button"
        >
          保存草稿
        </button>
        <button
          className="btn-primary disabled:opacity-50"
          disabled={isSubmitting || isLoadingOptions || !defaultModel}
          onClick={() => void submit(true)}
          type="button"
        >
          {form.inputMode === "record" ? "创建并进入录音页" : "创建并导入材料"}
        </button>
      </div>
    </section>
  );
}

function ModeCard({ label, description, active, onClick }: { label: string; description: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`rounded-lg border p-4 text-left transition ${active ? "border-blue-500 bg-blue-50 text-blue-900" : "border-line bg-white text-ink hover:bg-slate-50"}`}
      onClick={onClick}
      type="button"
    >
      <p className="text-base font-semibold">{label}</p>
      <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
    </button>
  );
}

function TextField({
  label,
  value,
  helper,
  options,
  onChange
}: {
  label: string;
  value: string;
  helper?: string;
  options?: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      {options ? (
        <select
          className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          onChange={(event) => onChange(event.target.value)}
          value={value}
        >
          {options.length === 0 ? <option value={value}>{value || "暂无可选配置"}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          onChange={(event) => onChange(event.target.value)}
          type="text"
          value={value}
        />
      )}
      {helper ? <span className="mt-1 block text-xs leading-5 text-muted">{helper}</span> : null}
    </label>
  );
}

function ReadOnlyField({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div>
      <span className="text-sm font-medium text-ink">{label}</span>
      <p className="mt-2 flex h-10 items-center rounded-md border border-line bg-slate-50 px-3 text-sm font-semibold text-ink">{value}</p>
      {helper ? <span className="mt-1 block text-xs leading-5 text-muted">{helper}</span> : null}
    </div>
  );
}
