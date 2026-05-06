"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiBaseUrl, apiGet, apiPost } from "../../../../lib/api";

const MINUTES_UNAPPLIED_MESSAGE = "纪要正文已修改。生成长图、Word 或发布语雀前，请先应用修改。";

type TranscriptSegment = {
  id: string;
  index: number;
  speaker?: string | null;
  startMs?: number | null;
  endMs?: number | null;
  text: string;
  isFinal: boolean;
  provider: string;
  rawPayload?: unknown;
  createdAt?: string;
};

type RecordingAsset = {
  id: string;
  filename: string;
  originalName?: string | null;
  mimeType: string;
  sizeBytes: number;
  publicUrl: string;
  createdAt: string;
};

type MeetingDetail = {
  id: string;
  title: string;
  projectName?: string | null;
  meetingType: string;
  inputMode?: "record" | "upload";
  startTime?: string | null;
  endTime?: string | null;
  participants?: string[];
  summaryModelConfigId?: string | undefined;
  status: string;
  lastError?: string | null;
  transcriptSegments?: TranscriptSegment[];
  recordingAssets?: RecordingAsset[];
  yuqueRepoNamespace?: string | null;
  yuquePublicLevel?: number | null;
  yuqueDocUrl?: string | null;
};

type MeetingMinutes = {
  id: string;
  structuredJson: unknown;
  markdownContent: string;
  promptVersion: string;
  createdAt: string;
  updatedAt: string;
};

type MeetingMinutesJson = {
  meeting_background?: {
    title?: string;
    topic?: string;
    time?: string;
    participants?: string[];
    project?: string;
    meeting_type?: string;
  };
  executive_summary?: {
    title?: string;
    subtitle?: string;
    one_sentence_conclusion?: string;
    summary_paragraph?: string;
  };
  visual_summary?: {
    milestones?: Array<{ date?: string; title?: string; bullets?: string[] }>;
    risk_cards?: Array<{ title?: string; level?: string; description?: string; impact?: string; suggestion?: string }>;
    key_actions?: Array<{ title?: string; owner?: string; due_date?: string; status?: string }>;
    core_consensus?: string;
  };
  module_progress?: Array<{
    module_name?: string;
    owner?: string;
    current_status?: string;
    progress_items?: string[];
    blockers?: string[];
    next_steps?: string[];
  }>;
  decisions?: Array<{ decision?: string; type?: string; evidence_text?: string }>;
  action_items?: Array<{ action?: string; owner?: string; due_date?: string; status?: string; evidence_text?: string }>;
  ai_insights?: Array<{ title?: string; content?: string; risk_level?: string; suggestion?: string }>;
  todos?: Array<{ text?: string; checked?: boolean }>;
  chapters?: Array<{ start_time?: string; title?: string; summary?: string }>;
};

type VisualReport = {
  id: string;
  imagePath?: string | null;
  imageUrl?: string | null;
  htmlPath?: string | null;
  createdAt: string;
};

type ModelConfigRow = {
  id: string;
  name: string;
  provider: string;
  model: string;
  enabled: boolean;
};

type YuqueRepo = {
  id: number;
  name: string;
  namespace: string;
};

type ReviewTab = "summary" | "chapters";

export function ReviewMeetingClient({
  initialMeeting,
  initialMinutes,
  initialVisualReport
}: {
  initialMeeting: MeetingDetail;
  initialMinutes: MeetingMinutes | null;
  initialVisualReport: VisualReport | null;
}) {
  const [meeting, setMeeting] = useState(initialMeeting);
  const [minutes, setMinutes] = useState(initialMinutes);
  const [visualReport, setVisualReport] = useState(initialVisualReport);
  const [markdownText, setMarkdownText] = useState(initialMinutes?.markdownContent ?? "");
  const [models, setModels] = useState<ModelConfigRow[]>([]);
  const [selectedModelConfigId, setSelectedModelConfigId] = useState(initialMeeting.summaryModelConfigId ?? "");
  const [yuqueRepos, setYuqueRepos] = useState<YuqueRepo[]>([]);
  const [selectedYuqueNamespace, setSelectedYuqueNamespace] = useState(initialMeeting.yuqueRepoNamespace ?? "");
  const [selectedYuquePublicLevel, setSelectedYuquePublicLevel] = useState(String(initialMeeting.yuquePublicLevel ?? 0));
  const [includeRecordingsInYuque, setIncludeRecordingsInYuque] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoadingTranscripts, setIsLoadingTranscripts] = useState(false);
  const [isMarkdownDirty, setIsMarkdownDirty] = useState(false);
  const [needsStructuredSync, setNeedsStructuredSync] = useState(initialMeeting.lastError === MINUTES_UNAPPLIED_MESSAGE);
  const [message, setMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ReviewTab>("summary");
  const [isEditingMarkdown, setIsEditingMarkdown] = useState(false);
  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);
  const autoRenderKeyRef = useRef<string | null>(null);
  const downstreamBlocked = isMarkdownDirty || needsStructuredSync;

  const structured = getStructuredMinutes(minutes?.structuredJson);
  const transcriptSegments = useMemo(
    () => [...(meeting.transcriptSegments ?? [])].sort((left, right) => left.index - right.index),
    [meeting.transcriptSegments]
  );
  const recordingAssets = useMemo(
    () => [...(meeting.recordingAssets ?? [])].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()),
    [meeting.recordingAssets]
  );
  const completeRecordings = recordingAssets.filter(isCompleteRecording);
  const recordingParts = recordingAssets.filter((asset) => !isCompleteRecording(asset));
  const latestRecording = completeRecordings.at(-1) ?? recordingAssets.at(-1);
  const participants = structured?.meeting_background?.participants?.length
    ? structured.meeting_background.participants
    : meeting.participants ?? [];
  const meetingTime = structured?.meeting_background?.time || formatMeetingTime(meeting.startTime, meeting.endTime);
  const canGenerateMinutes = meeting.inputMode === "upload"
    ? transcriptSegments.length > 0
    : transcriptSegments.length > 0 && meeting.status !== "draft" && meeting.status !== "recording";

  useEffect(() => {
    async function loadOptions() {
      const [modelsResult, reposResult] = await Promise.all([
        apiGet<ModelConfigRow[]>("/api/config/models"),
        apiGet<YuqueRepo[]>("/api/config/yuque/repos")
      ]);
      const enabledModels = (modelsResult.data ?? []).filter((item) => item.enabled);
      const repos = reposResult.data ?? [];
      setModels(enabledModels);
      setYuqueRepos(repos);
      if (!selectedModelConfigId && enabledModels[0]) {
        setSelectedModelConfigId(enabledModels[0].id);
      }
      if (!selectedYuqueNamespace && repos[0]) {
        setSelectedYuqueNamespace(repos[0].namespace);
      }
    }
    void loadOptions();
  }, [selectedModelConfigId, selectedYuqueNamespace]);

  useEffect(() => {
    void refreshTranscripts({ silent: true });

    if (meeting.status !== "recording") {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshTranscripts({ silent: true });
    }, 3000);

    return () => window.clearInterval(timer);
  }, [meeting.id, meeting.status]);

  useEffect(() => {
    if (!minutes?.id || visualReport?.imageUrl || downstreamBlocked || isRendering) {
      return;
    }
    if (autoRenderKeyRef.current === minutes.id) {
      return;
    }
    autoRenderKeyRef.current = minutes.id;
    void renderVisual({ ignoreBlocked: true, silent: true });
  }, [minutes?.id, visualReport?.imageUrl, downstreamBlocked, isRendering]);

  async function refreshTranscripts(options: { silent?: boolean } = {}) {
    setIsLoadingTranscripts(true);
    if (!options.silent) {
      setMessage("正在刷新转写内容...");
    }

    const result = await apiGet<TranscriptSegment[]>(`/api/meetings/${meeting.id}/transcript-segments`);
    setIsLoadingTranscripts(false);

    if (result.error || !result.data) {
      if (!options.silent) {
        setMessage(result.error ?? "转写内容拉取失败，请确认 API 服务正常。");
      }
      return;
    }

    setMeeting((current) => ({
      ...current,
      transcriptSegments: [...(result.data ?? [])].sort((left, right) => left.index - right.index)
    }));

    if (!options.silent) {
      setMessage(`已刷新 ${result.data.length} 段转写内容。`);
    }
  }

  async function generateMinutes() {
    if (!canGenerateMinutes) {
      setMessage(meeting.inputMode === "record" ? "请先结束会议，再生成会议纪要。" : "请先导入会议材料，再生成会议纪要。");
      return;
    }

    setIsGenerating(true);
    setMessage("正在调用纪要模型生成会议纪要...");

    const result = await apiPost<MeetingMinutes>(
      `/api/meetings/${meeting.id}/generate-minutes`,
      selectedModelConfigId ? { modelConfigId: selectedModelConfigId } : {}
    );
    setIsGenerating(false);

    if (result.error || !result.data) {
      setMessage(result.error ?? "纪要生成失败。请确认已有转写，并已配置可用模型。");
      return;
    }

    setMinutes(result.data);
    setMarkdownText(result.data.markdownContent);
    setIsMarkdownDirty(false);
    setNeedsStructuredSync(false);
    setIsEditingMarkdown(false);
    setActiveTab("summary");
    setMeeting((current) => ({
      ...current,
      status: "generated",
      summaryModelConfigId: selectedModelConfigId || current.summaryModelConfigId,
      lastError: typeof result.modelError === "string" ? result.modelError : null
    }));
    setVisualReport(null);
    autoRenderKeyRef.current = result.data.id;
    setMessage(result.fallback ? "模型输出不稳定，已生成基础纪要兜底，正在生成总结长图。" : "会议纪要已生成，正在生成总结长图。");
    const rendered = await renderVisual({ ignoreBlocked: true, silent: true });
    setMessage(
      rendered
        ? result.fallback
          ? "模型输出不稳定，已生成基础纪要兜底，并已刷新总结长图。"
          : "会议纪要和总结长图已生成。"
        : result.fallback
          ? "模型输出不稳定，已生成基础纪要兜底；总结长图生成失败，可稍后重试。"
          : "会议纪要已生成；总结长图生成失败，可稍后重试。"
    );
  }

  async function refreshMinutes() {
    const result = await apiGet<MeetingMinutes>(`/api/meetings/${meeting.id}/minutes`);
    if (result.data) {
      setMinutes(result.data);
      setMarkdownText(result.data.markdownContent);
      setIsMarkdownDirty(false);
      setNeedsStructuredSync(false);
      setMessage("纪要正文已刷新。");
    } else {
      setMessage(result.error ?? "暂无纪要。");
    }
  }

  async function syncStructuredJson() {
    if (!minutes) {
      setMessage("暂无纪要可应用。");
      return;
    }
    if (!markdownText.trim()) {
      setMessage("纪要正文不能为空。");
      return;
    }

    setIsSyncing(true);
    setMessage("正在应用纪要正文修改...");
    const result = await apiPost<MeetingMinutes>(`/api/meetings/${meeting.id}/minutes/sync-structured-json`, {
      markdownContent: markdownText
    });
    setIsSyncing(false);

    if (result.error || !result.data) {
      setMessage(result.error ?? "应用修改失败。纪要正文已保留，已生成的长图和发布数据暂未更新。");
      return;
    }

    setMinutes(result.data);
    setMarkdownText(result.data.markdownContent);
    setIsMarkdownDirty(false);
    setNeedsStructuredSync(false);
    setVisualReport(null);
    autoRenderKeyRef.current = result.data.id;
    setMeeting((current) => ({ ...current, status: "generated", lastError: null }));
    setIsEditingMarkdown(false);
    setMessage("修改已应用，正在刷新总结长图。");
    const rendered = await renderVisual({ ignoreBlocked: true, silent: true });
    setMessage(rendered ? "纪要正文、结构化内容和总结长图已刷新。" : "纪要正文和结构化内容已刷新；总结长图生成失败，可稍后重试。");
  }

  async function renderVisual(options: { ignoreBlocked?: boolean; silent?: boolean } = {}) {
    if (!options.ignoreBlocked && downstreamBlocked) {
      setMessage(MINUTES_UNAPPLIED_MESSAGE);
      return null;
    }

    setIsRendering(true);
    if (!options.silent) {
      setMessage("正在通过 Playwright 生成会议总结长图...");
    }

    const result = await apiPost<VisualReport>(`/api/meetings/${meeting.id}/render-visual`, {});
    setIsRendering(false);

    if (result.error || !result.data) {
      if (!options.silent) {
        setMessage(result.error ?? "生成长图失败。请确认 Web 服务已启动，并且纪要已生成。");
      }
      return null;
    }

    setVisualReport(result.data);
    setMeeting((current) => ({ ...current, status: "ready_to_publish", lastError: null }));
    if (!options.silent) {
      setMessage("长图已生成，可以发布到语雀或下载 PNG。");
    }
    return result.data;
  }

  async function publishYuque() {
    if (downstreamBlocked) {
      setMessage(MINUTES_UNAPPLIED_MESSAGE);
      return;
    }
    if (!selectedYuqueNamespace) {
      setMessage("请选择要发布到的语雀知识库。");
      return;
    }

    setIsPublishing(true);
    setMessage("正在发布到语雀...");

    const result = await apiPost<{ docUrl: string; status: string }>(`/api/meetings/${meeting.id}/publish-yuque`, {
      namespace: selectedYuqueNamespace,
      publicLevel: Number(selectedYuquePublicLevel),
      includeRecordings: includeRecordingsInYuque
    });
    setIsPublishing(false);

    if (result.error || !result.data) {
      setMessage(result.error ?? "发布语雀失败。请确认语雀 Token 已测试通过。");
      return;
    }

    setMeeting((current) => ({
      ...current,
      status: "published",
      yuqueRepoNamespace: selectedYuqueNamespace,
      yuquePublicLevel: Number(selectedYuquePublicLevel),
      yuqueDocUrl: result.data?.docUrl ?? current.yuqueDocUrl ?? null
    }));
    setMessage(`语雀发布成功：${result.data.docUrl}`);
  }

  return (
    <div className="space-y-4">
      {message ? <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">{message}</p> : null}
      {downstreamBlocked ? <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{MINUTES_UNAPPLIED_MESSAGE}</p> : null}

      <section className="grid min-h-[calc(100vh-190px)] gap-5 xl:grid-cols-[430px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-line bg-[#f8fbff] p-4">
          {meeting.inputMode === "upload" ? (
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-xs font-bold text-blue-700">上传 / 粘贴材料</p>
              <h3 className="mt-2 text-lg font-bold text-ink">已提取会议内容</h3>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <InfoBadge label="来源" value={getTranscriptSourceLabel(transcriptSegments)} />
                <InfoBadge label="段落" value={`${transcriptSegments.length} 段`} />
              </div>
              <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-sm leading-6 text-blue-800">
                这场会议来自粘贴文本或上传附件，不包含录音播放控制。如需更换原始内容，请返回导入页重新粘贴或上传。
              </p>
              <a className="mt-4 flex h-10 items-center justify-center rounded-lg border border-line text-sm font-semibold text-blue-700 hover:bg-blue-50" href={`/meetings/${meeting.id}/live`}>
                返回重新导入内容
              </a>
            </div>
          ) : (
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-xs font-bold text-blue-700">会议录音</p>
              <h3 className="mt-2 text-lg font-bold text-ink">{latestRecording ? "已保存录音文件" : "暂无录音文件"}</h3>
              {latestRecording ? (
                <div className="mt-4 space-y-3">
                  <audio className="w-full" controls preload="metadata" src={toAssetUrl(latestRecording.publicUrl)} />
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>{completeRecordings.length > 0 ? `完整录音 + ${recordingParts.length} 个分片备份` : `${recordingParts.length || recordingAssets.length} 个片段`}</span>
                    <span>{formatFileSize(recordingAssets.reduce((sum, item) => sum + item.sizeBytes, 0))}</span>
                  </div>
                  {recordingParts.length > 0 ? (
                    <details className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <summary className="cursor-pointer font-semibold text-slate-700">查看录音分片备份</summary>
                      <div className="mt-3 space-y-3">
                        {recordingParts.map((asset, index) => (
                          <div key={asset.id} className="rounded-lg bg-white p-2">
                            <p className="mb-2 text-xs font-semibold text-muted">录音片段 {index + 1} · {formatFileSize(asset.sizeBytes)}</p>
                            <audio className="w-full" controls preload="metadata" src={toAssetUrl(asset.publicUrl)} />
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </div>
              ) : (
                <div className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-sm leading-6 text-blue-800">
                  {transcriptSegments.length > 0
                    ? "这场会议已保存实时转写，但录音文件没有留存。可能是录音文件保存功能上线前的历史数据，或录音页中途关闭导致文件未上传。"
                    : "返回录音页开始录音并转写，结束或暂停时会自动保存录音文件。"}
                </div>
              )}
              <a className="mt-4 flex h-10 items-center justify-center rounded-lg border border-line text-sm font-semibold text-blue-700 hover:bg-blue-50" href={`/meetings/${meeting.id}/live`}>
                {meeting.status === "recording" ? "回到录音页" : "继续处理"}
              </a>
            </div>
          )}

          <div className="mt-6 flex items-center justify-between">
            <div>
              <h3 className="text-2xl font-bold text-ink">{meeting.inputMode === "upload" ? "提取内容" : "转写"}</h3>
              <p className="mt-1 text-sm text-muted">{transcriptSegments.length} 段原始内容</p>
            </div>
            <StatusPill status={meeting.status} />
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              className="flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
              disabled={isLoadingTranscripts}
              onClick={() => void refreshTranscripts()}
              type="button"
            >
              {isLoadingTranscripts ? "刷新中" : "刷新转写"}
            </button>
            <a className="flex-1 rounded-lg border border-line bg-white px-3 py-2 text-center text-sm font-semibold text-blue-700 hover:bg-blue-50" href={`/meetings/${meeting.id}/live`}>
              {meeting.inputMode === "upload" ? "重新导入" : "继续处理"}
            </a>
          </div>

          <div className="mt-5 max-h-[calc(100vh-455px)] min-h-[520px] overflow-auto pr-1">
            {transcriptSegments.length > 0 ? (
              <div className="space-y-5">
                {transcriptSegments.map((segment) => (
                  <TranscriptLine key={segment.id} segment={segment} />
                ))}
              </div>
            ) : (
              <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed border-line bg-white px-6 text-center text-sm leading-6 text-muted">
                暂无转写内容。请先录音转写，或在转写页导入粘贴文本/附件。
              </div>
            )}
          </div>
        </aside>

        <section className="rounded-2xl border border-line bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-muted">AI 会议纪要</p>
              <h3 className="mt-1 text-2xl font-bold text-ink">{meeting.title}</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                className="h-10 rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                onChange={(event) => setSelectedModelConfigId(event.target.value)}
                value={selectedModelConfigId}
              >
                {models.length === 0 ? <option value="">暂无可用模型</option> : null}
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
              <button
                className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
                disabled={isGenerating || models.length === 0 || !canGenerateMinutes}
                onClick={() => void generateMinutes()}
                type="button"
              >
                {isGenerating ? "生成中..." : minutes ? "重新生成" : "生成纪要"}
              </button>
              <details className="relative">
                <summary className="flex h-10 cursor-pointer list-none items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-slate-50">
                  更多
                </summary>
                <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-line bg-white p-3 shadow-xl">
                  <button
                    className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-ink hover:bg-slate-50 disabled:opacity-50"
                    disabled={!minutes}
                    onClick={() => setIsEditingMarkdown(true)}
                    type="button"
                  >
                    编辑纪要
                  </button>
                  {minutes && !downstreamBlocked ? (
                    <a className="block rounded-lg px-3 py-2 text-sm font-semibold text-ink hover:bg-slate-50" download href={`${apiBaseUrl}/api/meetings/${meeting.id}/minutes.docx`}>
                      下载总结 Word
                    </a>
                  ) : (
                    <button className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-ink opacity-50" disabled type="button">
                      下载总结 Word
                    </button>
                  )}
                  {visualReport?.imagePath && !downstreamBlocked ? (
                    <a className="block rounded-lg px-3 py-2 text-sm font-semibold text-ink hover:bg-slate-50" download href={`${apiBaseUrl}/api/meetings/${meeting.id}/visual-report/download`}>
                      下载总结长图
                    </a>
                  ) : (
                    <button className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-ink opacity-50" disabled type="button">
                      下载总结长图
                    </button>
                  )}
                  <div className="my-2 border-t border-line" />
                  <label className="block px-3 py-1">
                    <span className="text-xs font-semibold text-muted">语雀知识库</span>
                    <select className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" onChange={(event) => setSelectedYuqueNamespace(event.target.value)} value={selectedYuqueNamespace}>
                      {yuqueRepos.length === 0 ? <option value="">请先在设置页配置语雀</option> : null}
                      {yuqueRepos.map((repo) => (
                        <option key={repo.namespace} value={repo.namespace}>
                          {repo.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block px-3 py-1">
                    <span className="text-xs font-semibold text-muted">公开级别</span>
                    <select className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" onChange={(event) => setSelectedYuquePublicLevel(event.target.value)} value={selectedYuquePublicLevel}>
                      <option value="0">继承默认</option>
                      <option value="1">公开</option>
                      <option value="2">私密</option>
                    </select>
                  </label>
                  {recordingAssets.length > 0 ? (
                    <label className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                      <input
                        checked={includeRecordingsInYuque}
                        className="mt-1"
                        onChange={(event) => setIncludeRecordingsInYuque(event.target.checked)}
                        type="checkbox"
                      />
                      <span>
                        随文档发布录音。若录音仍是本机链接，语雀正文会带播放器和下载链接，但仅当前电脑且 API 服务运行时可访问；不勾选则只发布纪要正文和长图。
                      </span>
                    </label>
                  ) : null}
                  <button className="mt-2 w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={isPublishing || !minutes || downstreamBlocked || !selectedYuqueNamespace} onClick={() => void publishYuque()} type="button">
                    {isPublishing ? "发布中..." : "推送语雀"}
                  </button>
                </div>
              </details>
            </div>
          </div>

          {!canGenerateMinutes && meeting.inputMode === "record" && !minutes ? (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">录音会议需要先点击“结束会议”，确认转写完成后再生成纪要。</p>
          ) : null}

          <div className="mt-6 flex gap-8 border-b border-line">
            <TabButton active={activeTab === "summary"} label="AI 纪要" onClick={() => setActiveTab("summary")} />
            <TabButton active={activeTab === "chapters"} label="章节" onClick={() => setActiveTab("chapters")} />
          </div>

          {activeTab === "summary" ? (
            <div className="mt-6 space-y-5">
              <section className="border-l-4 border-slate-200 pl-4 text-base leading-8 text-muted">
                <p>
                  <span className="font-bold text-ink">主题：</span>
                  {structured?.meeting_background?.topic || meeting.title}
                </p>
                <p>
                  <span className="font-bold text-ink">时间：</span>
                  {meetingTime || "待定"}
                </p>
                <p>
                  <span className="font-bold text-ink">参与人：</span>
                  {participants.length > 0 ? participants.join("、") : "待定"}
                </p>
              </section>

              {minutes ? (
                <>
                  {visualReport?.imageUrl ? (
                    <section className="h-[calc(100vh-380px)] min-h-[560px] overflow-y-auto rounded-xl bg-slate-50 p-4">
                      <button className="block w-full cursor-zoom-in" onClick={() => setIsImagePreviewOpen(true)} type="button">
                        <img alt="会议总结长图预览" className="h-auto w-full rounded-xl border border-line bg-white" src={visualReport.imageUrl} />
                      </button>
                      <p className="sticky bottom-0 mt-3 rounded-lg bg-white/90 px-3 py-2 text-center text-sm text-muted backdrop-blur">点击图片可放大查看总结长图</p>
                    </section>
                  ) : (
                    <section className="flex min-h-[520px] items-center justify-center rounded-xl border border-dashed border-line bg-slate-50 p-8 text-center">
                      <div>
                        <h4 className="text-lg font-bold text-ink">{isRendering ? "正在生成总结长图" : "总结长图待生成"}</h4>
                        <p className="mt-2 text-sm text-muted">生成纪要后系统会自动生成长图，无需手动触发。</p>
                      </div>
                    </section>
                  )}

                  <section className="rounded-xl border border-line">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
                      <div>
                        <h4 className="text-base font-semibold text-ink">纪要正文</h4>
                        <p className="mt-1 text-sm text-muted">编辑后点击“保存并刷新”，AI 纪要和总结长图会一起更新。</p>
                      </div>
                      <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink hover:bg-slate-50" onClick={() => setIsEditingMarkdown((current) => !current)} type="button">
                        {isEditingMarkdown ? "收起编辑" : "编辑正文"}
                      </button>
                    </div>
                    {isEditingMarkdown ? (
                      <div className="p-4">
                        <textarea
                          className="min-h-[420px] w-full resize-y rounded-lg border border-line p-4 font-mono text-sm leading-7 text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          onChange={(event) => {
                            setMarkdownText(event.target.value);
                            setIsMarkdownDirty(true);
                          }}
                          spellCheck={false}
                          value={markdownText}
                        />
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button className="btn-primary disabled:opacity-50" disabled={isSyncing || !minutes || (!isMarkdownDirty && !needsStructuredSync)} onClick={() => void syncStructuredJson()} type="button">
                            {isSyncing || isRendering ? "刷新中..." : "保存并刷新"}
                          </button>
                          <button className="btn-secondary" onClick={() => void refreshMinutes()} type="button">
                            刷新正文
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="max-h-[520px] overflow-auto bg-white p-5">
                        <MarkdownPreview content={markdownText} />
                      </div>
                    )}
                  </section>
                </>
              ) : (
                <EmptyMinutesState canGenerate={canGenerateMinutes} isGenerating={isGenerating} onGenerate={() => void generateMinutes()} />
              )}
            </div>
          ) : null}

          {activeTab === "chapters" ? <ChaptersPanel chapters={structured?.chapters ?? []} /> : null}

          {meeting.lastError && meeting.lastError !== MINUTES_UNAPPLIED_MESSAGE ? (
            <article className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{meeting.lastError}</article>
          ) : null}

          <details className="mt-5 rounded-lg border border-line p-4">
            <summary className="cursor-pointer text-sm font-semibold text-muted">开发调试：结构化 JSON</summary>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-700">
              {minutes ? JSON.stringify(minutes.structuredJson, null, 2) : "暂无"}
            </pre>
          </details>
        </section>
      </section>

      {isImagePreviewOpen && visualReport?.imageUrl ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={() => setIsImagePreviewOpen(false)}>
          <button className="absolute right-6 top-6 rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-ink" onClick={() => setIsImagePreviewOpen(false)} type="button">
            关闭
          </button>
          <div className="max-h-[92vh] w-[min(1080px,92vw)] overflow-y-auto rounded-xl bg-white" onClick={(event) => event.stopPropagation()}>
            <img alt="会议总结长图放大预览" className="h-auto w-full" src={visualReport.imageUrl} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MarkdownPreview({ content }: { content: string }) {
  if (!content.trim()) {
    return <p className="text-sm text-muted">暂无纪要正文。</p>;
  }

  return (
    <div className="minutes-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} rel="noreferrer" target="_blank">
              {children}
            </a>
          ),
          input: (props) => <input {...props} disabled />
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={`relative pb-3 text-lg font-bold ${active ? "text-ink" : "text-muted hover:text-ink"}`}
      onClick={onClick}
      type="button"
    >
      {label}
      {active ? <span className="absolute inset-x-0 -bottom-px mx-auto h-1 w-10 rounded-full bg-ink" /> : null}
    </button>
  );
}

function TranscriptLine({ segment }: { segment: TranscriptSegment }) {
  const speaker = segment.speaker || getTranscriptLineSource(segment);
  const marker = formatTranscriptTime(segment.startMs) || `#${segment.index + 1}`;
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-50 text-xs font-bold text-blue-700">{speaker.slice(0, 2)}</span>
        <span className="font-semibold text-slate-700">{speaker}</span>
        <span>{marker}</span>
      </div>
      <p className="mt-3 whitespace-pre-wrap break-words text-base leading-8 text-ink">{segment.text}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const label = {
    draft: "未开始",
    recording: "录音中",
    recorded: "待生成",
    generating: "生成中",
    generated: "已生成",
    rendering: "长图中",
    ready_to_publish: "待发布",
    publishing: "发布中",
    published: "已发布",
    failed: "异常"
  }[status] ?? status;
  return <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-blue-700">{label}</span>;
}

function InfoBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 truncate font-semibold text-ink">{value}</p>
    </div>
  );
}

function getTranscriptSourceLabel(segments: TranscriptSegment[]) {
  const sources = new Set(segments.map(getTranscriptLineSource));
  if (sources.size > 1) {
    return "混合导入";
  }
  return sources.values().next().value ?? "暂无";
}

function getTranscriptLineSource(segment: TranscriptSegment) {
  if (segment.rawPayload && typeof segment.rawPayload === "object" && "source" in segment.rawPayload && (segment.rawPayload as { source?: unknown }).source === "file_upload") {
    return "上传附件";
  }
  if (segment.provider === "doubao_asr") return "实时转写";
  if (segment.provider === "manual_paste") return "粘贴文本";
  return "导入材料";
}

function isCompleteRecording(asset: RecordingAsset) {
  return asset.filename.includes("complete-recording") || asset.originalName?.includes("完整录音");
}

function EmptyMinutesState({ canGenerate, isGenerating, onGenerate }: { canGenerate: boolean; isGenerating: boolean; onGenerate: () => void }) {
  return (
    <div className="flex min-h-[520px] items-center justify-center rounded-xl border border-dashed border-line bg-slate-50 p-8 text-center">
      <div>
        <h4 className="text-xl font-bold text-ink">还没有 AI 纪要</h4>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted">确认转写内容后，点击生成纪要。系统会生成摘要、行动项、风险、章节，并支持继续编辑和导出。</p>
        <button className="btn-primary mt-5 disabled:opacity-50" disabled={!canGenerate || isGenerating} onClick={onGenerate} type="button">
          {isGenerating ? "生成中..." : "生成 AI 纪要"}
        </button>
      </div>
    </div>
  );
}

function ChaptersPanel({ chapters }: { chapters: NonNullable<MeetingMinutesJson["chapters"]> }) {
  return (
    <div className="mt-6">
      {chapters.length > 0 ? (
        <div className="space-y-4 border-l-2 border-blue-100 pl-5">
          {chapters.map((chapter, index) => (
            <article key={`${chapter.start_time}-${chapter.title}-${index}`} className="relative rounded-xl bg-slate-50 p-4">
              <span className="absolute -left-[29px] top-5 h-3 w-3 rounded-full bg-blue-600" />
              <p className="text-sm font-bold text-blue-700">{chapter.start_time || "--:--"}</p>
              <h4 className="mt-1 text-base font-semibold text-ink">{chapter.title || `章节 ${index + 1}`}</h4>
              <p className="mt-2 text-sm leading-7 text-slate-700">{chapter.summary || "暂无摘要"}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed border-line bg-slate-50 text-sm text-muted">生成纪要后会在这里展示章节。</div>
      )}
    </div>
  );
}

function getStructuredMinutes(value: unknown): MeetingMinutesJson | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as MeetingMinutesJson;
}

function formatTranscriptTime(value?: number | null) {
  if (typeof value !== "number") {
    return "";
  }
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getDurationLabel(segments: TranscriptSegment[]) {
  const lastEndMs = [...segments].reverse().find((segment) => typeof segment.endMs === "number")?.endMs;
  if (typeof lastEndMs === "number") {
    return formatTranscriptTime(lastEndMs);
  }
  return segments.length > 0 ? `${segments.length} 段` : "00:00";
}

function toAssetUrl(publicUrl: string) {
  if (/^https?:\/\//i.test(publicUrl)) {
    return publicUrl;
  }
  return `${apiBaseUrl.replace(/\/$/, "")}${publicUrl.startsWith("/") ? publicUrl : `/${publicUrl}`}`;
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  }
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatMeetingTime(start?: string | null, end?: string | null) {
  if (!start && !end) {
    return "";
  }
  if (start && end) {
    return `${formatDateTime(start)} 至 ${formatDateTime(end)}`;
  }
  return formatDateTime(start || end || "");
}

function formatDateTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
