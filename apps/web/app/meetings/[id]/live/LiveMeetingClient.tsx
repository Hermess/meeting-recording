"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiBaseUrl, apiGet, apiPost } from "../../../../lib/api";

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
  status: string;
  lastError?: string | null;
  transcriptSegments?: TranscriptSegment[];
  recordingAssets?: RecordingAsset[];
  meetingMinutes?: Array<{ id: string }>;
};

type MeetingMinutes = {
  id: string;
  structuredJson: unknown;
  markdownContent: string;
};

type AsrStatus = "idle" | "connecting" | "connected" | "stopping" | "closed" | "failed";
type MicStatus = "idle" | "requesting" | "active" | "failed";
type MicDeviceOption = {
  deviceId: string;
  label: string;
};

const RECORDING_SLICE_MS = 5 * 60 * 1000;
const MIN_RECORDING_BLOB_BYTES = 1024;

export function LiveMeetingClient({ initialMeeting }: { initialMeeting: MeetingDetail }) {
  const router = useRouter();
  const [meeting, setMeeting] = useState(initialMeeting);
  const [segments, setSegments] = useState<TranscriptSegment[]>(initialMeeting.transcriptSegments ?? []);
  const [manualText, setManualText] = useState("");
  const [message, setMessage] = useState<string | null>(initialMeeting.lastError ?? null);
  const [isBusy, setIsBusy] = useState(false);
  const [isGeneratingMinutes, setIsGeneratingMinutes] = useState(false);
  const [asrStatus, setAsrStatus] = useState<AsrStatus>("idle");
  const [micStatus, setMicStatus] = useState<MicStatus>("idle");
  const [partialTranscript, setPartialTranscript] = useState("");
  const [volume, setVolume] = useState(0);
  const [maxVolume, setMaxVolume] = useState(0);
  const [chunkCount, setChunkCount] = useState(0);
  const [lastAsrMessage, setLastAsrMessage] = useState("尚未连接");
  const [recordingUploadStatus, setRecordingUploadStatus] = useState("未启动");
  const [recordingUploadedParts, setRecordingUploadedParts] = useState(initialMeeting.recordingAssets?.length ?? 0);
  const [recordingUploadedBytes, setRecordingUploadedBytes] = useState(
    (initialMeeting.recordingAssets ?? []).reduce((sum, asset) => sum + asset.sizeBytes, 0)
  );
  const [micDevices, setMicDevices] = useState<MicDeviceOption[]>([]);
  const [selectedMicDeviceId, setSelectedMicDeviceId] = useState("");
  const transcriptText = segments.map((segment) => segment.text).filter(Boolean).join("\n");
  const transcriptSources = Array.from(new Set(segments.map(renderTranscriptSource)));
  const isUploadMode = meeting.inputMode === "upload";
  const hasMinutes =
    Boolean(meeting.meetingMinutes?.length) ||
    meeting.status === "generated" ||
    meeting.status === "ready_to_publish" ||
    meeting.status === "publishing" ||
    meeting.status === "published";
  const primaryAction = getPrimaryWorkflowAction({
    asrStatus,
    hasMinutes,
    hasTranscript: segments.length > 0,
    isBusy,
    isGeneratingMinutes,
    meetingStatus: meeting.status
  });
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const silenceGainRef = useRef<GainNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingPartIndexRef = useRef(initialMeeting.recordingAssets?.length ?? 0);
  const recordingUploadPromisesRef = useRef<Array<Promise<RecordingAsset | null>>>([]);
  const recordingUploadedBytesRef = useRef((initialMeeting.recordingAssets ?? []).reduce((sum, asset) => sum + asset.sizeBytes, 0));
  const pcmBufferRef = useRef<Float32Array>(new Float32Array(0));
  const sequenceRef = useRef(0);
  const sourceSampleRateRef = useRef(48000);
  const refreshTimerRef = useRef<number | null>(null);
  const finalizeResolveRef = useRef<(() => void) | null>(null);
  const noTranscriptMessageRef = useRef<string | null>(null);

  const refreshTranscriptSegments = useCallback(async (showMessage = false) => {
    const result = await apiGet<TranscriptSegment[]>(`/api/meetings/${meeting.id}/transcript-segments`);
    if (result.error || !result.data) {
      if (showMessage) {
        setMessage(result.error ?? "拉取转写段落失败。");
      }
      return;
    }

    setSegments(sortTranscriptSegments(result.data ?? []));

    if (result.data.length > 0) {
      setLastAsrMessage(`已拉取 ${result.data.length} 段转写`);
    }
  }, [meeting.id]);

  useEffect(() => {
    const shouldPoll = asrStatus === "connecting" || asrStatus === "connected" || asrStatus === "stopping" || meeting.status === "recording";
    if (!shouldPoll) {
      if (refreshTimerRef.current !== null) {
        window.clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      return;
    }

    void refreshTranscriptSegments();
    refreshTimerRef.current = window.setInterval(() => {
      void refreshTranscriptSegments();
    }, 1500);

    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [asrStatus, meeting.status, refreshTranscriptSegments]);

  useEffect(() => {
    void refreshMicDevices();
  }, []);

  async function startRecordingAndTranscription() {
    if (asrStatus === "connecting" || asrStatus === "connected") {
      setMessage("实时转写已经在运行。");
      return;
    }

    setIsBusy(true);
    try {
      if (meeting.status !== "recording") {
        const result = await apiPost<MeetingDetail>(`/api/meetings/${meeting.id}/start`, {});
        if (result.error || !result.data) {
          setMessage(result.error ?? "开始会议失败");
          return;
        }
        setMeeting((current) => ({ ...current, status: result.data?.status ?? "recording", lastError: null }));
      }

      setMessage("正在请求麦克风并连接实时 ASR...");
      await startRealtimeAsr();
    } finally {
      setIsBusy(false);
    }
  }

  async function stopMeeting() {
    await stopRealtimeAsr();
    setIsBusy(true);
    const result = await apiPost<MeetingDetail>(`/api/meetings/${meeting.id}/stop`, {});
    setIsBusy(false);
    if (result.error || !result.data) {
      setMessage(result.error ?? "结束会议失败");
      return;
    }
    setMeeting((current) => ({ ...current, status: result.data?.status ?? "recorded" }));
    setMessage("会议已结束，可以生成会议纪要。");
    void refreshTranscriptSegments(true);
    window.setTimeout(() => void refreshTranscriptSegments(true), 1800);
  }

  async function startRealtimeAsr() {
    if (wsRef.current?.readyState === WebSocket.OPEN || asrStatus === "connecting") {
      return;
    }

    setAsrStatus("connecting");
    setMicStatus("requesting");
    setPartialTranscript("");
    setChunkCount(0);
    setMaxVolume(0);
    setLastAsrMessage("正在初始化麦克风");
    noTranscriptMessageRef.current = null;
    sequenceRef.current = 0;
    pcmBufferRef.current = new Float32Array(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(selectedMicDeviceId ? { deviceId: { exact: selectedMicDeviceId } } : {}),
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      streamRef.current = stream;
      setMicStatus("active");
      void refreshMicDevices();
      startLocalRecorder(stream);

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;
      sourceSampleRateRef.current = audioContext.sampleRate;
      await audioContext.audioWorklet.addModule("/audio-worklet/pcm-processor.js");

      const source = audioContext.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(audioContext, "meeting-ai-kit-pcm-processor");
      const silenceGain = audioContext.createGain();
      silenceGain.gain.value = 0;
      sourceNodeRef.current = source;
      audioNodeRef.current = node;
      silenceGainRef.current = silenceGain;
      node.port.onmessage = (event: MessageEvent<{ samples?: Float32Array }>) => {
        if (event.data.samples) {
          handleSamples(event.data.samples);
        }
      };
      source.connect(node);
      node.connect(silenceGain);
      silenceGain.connect(audioContext.destination);
      await audioContext.resume();

      const ws = new WebSocket(buildAsrWebSocketUrl(meeting.id));
      wsRef.current = ws;
      ws.onopen = () => {
        setAsrStatus("connected");
        setLastAsrMessage("实时 ASR 已连接");
        setMessage("实时 ASR 已连接，正在转写麦克风音频。");
      };
      ws.onmessage = (event) => handleAsrServerEvent(event.data);
      ws.onerror = () => {
        setAsrStatus("failed");
        setLastAsrMessage("实时 ASR 连接异常");
        setMessage("实时 ASR 连接异常。你仍可以使用粘贴转写兜底。");
      };
      ws.onclose = () => {
        setAsrStatus((current) => (current === "stopping" ? "closed" : current === "failed" ? "failed" : "closed"));
        setLastAsrMessage((current) => (current === "实时 ASR 连接异常" ? current : "实时 ASR 已关闭"));
      };
    } catch (error) {
      void stopRealtimeAsr();
      setAsrStatus("failed");
      setMicStatus("failed");
      setLastAsrMessage("麦克风或 ASR 初始化失败");
      setMessage(error instanceof Error ? `麦克风或 ASR 初始化失败：${error.message}` : "麦克风或 ASR 初始化失败。");
    }
  }

  async function stopRealtimeAsr() {
    setAsrStatus("stopping");
    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;
    audioNodeRef.current?.disconnect();
    audioNodeRef.current = null;
    silenceGainRef.current?.disconnect();
    silenceGainRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    await stopLocalRecorderAndUpload();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    pcmBufferRef.current = new Float32Array(0);
    setMicStatus("idle");
    setPartialTranscript("");
    setVolume(0);
    await finishAsrWebSocket();
    window.setTimeout(() => void refreshTranscriptSegments(), 700);
    window.setTimeout(() => void refreshTranscriptSegments(), 1800);
  }

  function startLocalRecorder(stream: MediaStream) {
    if (typeof MediaRecorder === "undefined") {
      setLastAsrMessage("当前浏览器不支持保存录音文件");
      return;
    }

    try {
      const mimeType = getSupportedRecordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordingPartIndexRef.current = meeting.recordingAssets?.length ?? 0;
      recordingUploadPromisesRef.current = [];
      setRecordingUploadStatus(`录音按 ${Math.round(RECORDING_SLICE_MS / 60000)} 分钟分片保存，避免长会占用内存。`);
      recorder.ondataavailable = (event) => {
        if (event.data.size >= MIN_RECORDING_BLOB_BYTES) {
          queueRecordingUpload(event.data);
        }
      };
      recorder.onerror = () => {
        setRecordingUploadStatus("本地录音保存异常，不影响实时转写。");
        setLastAsrMessage("本地录音保存异常，不影响实时转写");
      };
      recorder.start(RECORDING_SLICE_MS);
      mediaRecorderRef.current = recorder;
    } catch (error) {
      mediaRecorderRef.current = null;
      recordingUploadPromisesRef.current = [];
      setRecordingUploadStatus(error instanceof Error ? `录音文件保存未启动：${error.message}` : "录音文件保存未启动");
      setLastAsrMessage(error instanceof Error ? `录音文件保存未启动：${error.message}` : "录音文件保存未启动");
    }
  }

  async function stopLocalRecorderAndUpload() {
    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      return;
    }

    mediaRecorderRef.current = null;
    await new Promise<void>((resolve) => {
      const finish = () => resolve();
      recorder.onstop = finish;
      try {
        if (recorder.state !== "inactive") {
          recorder.requestData();
          recorder.stop();
        } else {
          finish();
        }
      } catch {
        finish();
      }
    });

    const uploadResults = await Promise.allSettled(recordingUploadPromisesRef.current);
    recordingUploadPromisesRef.current = [];
    const savedCount = uploadResults.filter((result) => result.status === "fulfilled" && result.value).length;
    if (savedCount > 0) {
      setRecordingUploadStatus(`录音已分片保存，共 ${recordingPartIndexRef.current} 个片段。`);
      setLastAsrMessage(`录音已分片保存，共 ${recordingPartIndexRef.current} 个片段`);
      await mergeRecordingParts();
    } else {
      setRecordingUploadStatus("未保存到有效录音片段。转写内容已保留。");
    }
  }

  function queueRecordingUpload(blob: Blob) {
    const partIndex = recordingPartIndexRef.current + 1;
    recordingPartIndexRef.current = partIndex;
    setRecordingUploadStatus(`正在保存录音片段 ${partIndex}...`);
    const uploadPromise = uploadRecordingBlob(blob, partIndex).then((asset) => {
      if (asset) {
        recordingUploadedBytesRef.current += asset.sizeBytes;
        setRecordingUploadedParts((current) => Math.max(current, partIndex));
        setRecordingUploadedBytes(recordingUploadedBytesRef.current);
        setRecordingUploadStatus(`已保存录音片段 ${partIndex}（累计 ${formatFileSize(recordingUploadedBytesRef.current)}）。`);
      }
      return asset;
    });
    recordingUploadPromisesRef.current.push(uploadPromise);
  }

  async function uploadRecordingBlob(blob: Blob, partIndex: number) {
    const extension = getRecordingExtension(blob.type);
    const formData = new FormData();
    formData.append("file", blob, `recording-part-${String(partIndex).padStart(3, "0")}-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`);
    const response = await fetch(`${apiBaseUrl}/api/meetings/${meeting.id}/recordings`, {
      method: "POST",
      credentials: "include",
      body: formData
    }).catch(
      (error) =>
        ({
          ok: false,
          json: async () => ({ message: error instanceof Error ? error.message : "录音文件上传失败" })
        }) as Response
    );
    const payload = (await response.json().catch(() => ({}))) as {
      data?: RecordingAsset;
      message?: string;
      error?: string;
    };

    if (!response.ok || !payload.data) {
      setRecordingUploadStatus(`录音片段 ${partIndex} 保存失败。转写内容已保留。`);
      setMessage(payload.message ?? payload.error ?? "录音文件保存失败。转写内容已保留。");
      return null;
    }

    setMeeting((current) => ({
      ...current,
      recordingAssets: [...(current.recordingAssets ?? []), payload.data!]
    }));
    return payload.data;
  }

  async function mergeRecordingParts() {
    setRecordingUploadStatus("正在合成完整录音文件...");
    const result = await apiPost<RecordingAsset>(`/api/meetings/${meeting.id}/recordings/merge`, {});
    if (result.error || !result.data) {
      setRecordingUploadStatus(result.error ? `录音分片已保存，完整文件合成失败：${result.error}` : "录音分片已保存，完整文件合成失败。");
      return;
    }
    setMeeting((current) => {
      const withoutDuplicate = (current.recordingAssets ?? []).filter((asset) => asset.id !== result.data!.id);
      return {
        ...current,
        recordingAssets: [...withoutDuplicate, result.data!]
      };
    });
    setRecordingUploadStatus(`完整录音已保存：${formatFileSize(result.data.sizeBytes)}。`);
    setLastAsrMessage("完整录音已保存");
  }

  async function finishAsrWebSocket() {
    const ws = wsRef.current;
    if (!ws) {
      setAsrStatus("closed");
      return;
    }

    if (ws.readyState !== WebSocket.OPEN) {
      ws.close();
      wsRef.current = null;
      setAsrStatus("closed");
      return;
    }

    setLastAsrMessage("正在收尾实时转写");
    const finalized = new Promise<void>((resolve) => {
      finalizeResolveRef.current = resolve;
      window.setTimeout(resolve, 6500);
    });
    ws.send(JSON.stringify({ type: "finish" }));
    await finalized;
    finalizeResolveRef.current = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(1000, "client stopped after finalize");
    }
    wsRef.current = null;
  }

  function handleSamples(samples: Float32Array) {
    const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / Math.max(samples.length, 1));
    const nextVolume = Math.min(100, Math.round(rms * 160));
    setVolume(nextVolume);
    setMaxVolume((current) => Math.max(current, nextVolume));

    const resampled = resampleLinear(samples, sourceSampleRateRef.current, 16000);
    pcmBufferRef.current = concatFloat32(pcmBufferRef.current, resampled);
    const chunkSamples = 3200;

    while (pcmBufferRef.current.length >= chunkSamples) {
      const chunk = pcmBufferRef.current.slice(0, chunkSamples);
      pcmBufferRef.current = pcmBufferRef.current.slice(chunkSamples);
      sendPcmChunk(chunk);
    }
  }

  function sendPcmChunk(samples: Float32Array) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(
      JSON.stringify({
        type: "audio_chunk",
        sequence: sequenceRef.current++,
        audio: float32ToPcm16Base64(samples),
        sampleRate: 16000,
        chunkMs: 200
      })
    );
    setChunkCount((current) => current + 1);
  }

  function handleAsrServerEvent(raw: string) {
    try {
      const event = JSON.parse(raw) as {
        type?: string;
        status?: string;
        message?: string;
        code?: string;
        text?: string;
        isFinal?: boolean;
        segment?: TranscriptSegment;
      };
      if (event.type === "status") {
        if (event.status === "no_transcript") {
          const diagnostic = event.message ?? "ASR 未识别到有效语音。";
          noTranscriptMessageRef.current = diagnostic;
          setLastAsrMessage(diagnostic);
          setMessage(diagnostic);
          return;
        }
        if (event.status === "finalized") {
          setAsrStatus("closed");
          finalizeResolveRef.current?.();
          void refreshTranscriptSegments(true);
          if (noTranscriptMessageRef.current) {
            setLastAsrMessage(noTranscriptMessageRef.current);
            setMessage(noTranscriptMessageRef.current);
            return;
          }
        } else if (isAsrStatus(event.status)) {
          setAsrStatus(event.status);
          if (event.status === "closed" && noTranscriptMessageRef.current) {
            setLastAsrMessage(noTranscriptMessageRef.current);
            setMessage(noTranscriptMessageRef.current);
            return;
          }
        }
        setLastAsrMessage(event.message ?? event.status ?? "ASR 状态更新");
        if (event.message) setMessage(event.message);
        return;
      }
      if (event.type === "error") {
        setAsrStatus("failed");
        setLastAsrMessage(event.message ?? event.code ?? "实时 ASR 返回错误");
        setMessage(event.message ?? event.code ?? "实时 ASR 返回错误。");
        return;
      }
      if (event.type === "transcript" && event.segment) {
        setSegments((current) => mergeTranscriptSegments(current, [event.segment!]));
        setPartialTranscript("");
        setLastAsrMessage(`已保存转写段 #${event.segment.index + 1}`);
        return;
      }
      if (event.type === "transcript" && event.text) {
        setPartialTranscript(event.text);
        setLastAsrMessage("收到临时识别结果");
      }
    } catch {
      setMessage("实时 ASR 消息解析失败。");
    }
  }

  async function saveManualTranscript() {
    if (!manualText.trim()) {
      setMessage("请先粘贴转写文本。");
      return;
    }

    setIsBusy(true);
    const result = await apiPost<TranscriptSegment[]>(`/api/meetings/${meeting.id}/transcript-segments`, {
      provider: "manual_paste",
      text: manualText
    });
    setIsBusy(false);

    if (result.error || !result.data) {
      setMessage(result.error ?? "保存转写失败");
      return;
    }

    setSegments((current) => mergeTranscriptSegments(current, result.data ?? []));
    setManualText("");
    setMessage(`已保存 ${result.data.length} 段转写。`);
  }

  async function uploadTranscriptFile(file: File | null) {
    if (!file) {
      return;
    }

    setIsBusy(true);
    setMessage(`正在解析文件：${file.name}`);
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`${apiBaseUrl}/api/meetings/${meeting.id}/transcript-upload`, {
      method: "POST",
      credentials: "include",
      body: formData
    }).catch(
      (error) =>
        ({
          ok: false,
          json: async () => ({ message: error instanceof Error ? error.message : "上传失败" })
        }) as Response
    );
    const payload = (await response.json().catch(() => ({}))) as {
      data?: TranscriptSegment[];
      message?: string;
      error?: string;
      filename?: string;
    };
    setIsBusy(false);

    if (!response.ok || !payload.data) {
      setMessage(payload.message ?? payload.error ?? "文件解析失败。");
      return;
    }

    setSegments((current) => mergeTranscriptSegments(current, payload.data ?? []));
    setMessage(`已导入 ${payload.filename ?? file.name}，新增 ${payload.data.length} 段转写。`);
  }

  async function refreshMicDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const audioInputs = devices
      .filter((device) => device.kind === "audioinput")
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `麦克风 ${index + 1}`
      }));
    setMicDevices(audioInputs);
    if (selectedMicDeviceId && !audioInputs.some((device) => device.deviceId === selectedMicDeviceId)) {
      setSelectedMicDeviceId("");
    }
  }

  async function generateMinutesAndOpen() {
    if (segments.length === 0) {
      setMessage("请先录音转写或粘贴转写文本，再生成纪要。");
      return;
    }

    setIsGeneratingMinutes(true);
    setMessage("正在生成会议纪要，完成后会自动打开纪要页。");
    const result = await apiPost<MeetingMinutes>(`/api/meetings/${meeting.id}/generate-minutes`, {});
    setIsGeneratingMinutes(false);

    if (result.error || !result.data) {
      setMessage(result.error ?? "纪要生成失败。");
      return;
    }

    const fallbackMessage = result.fallback ? "模型输出不稳定，已生成基础纪要兜底。" : "纪要已生成。";
    setMeeting((current) => ({ ...current, status: "generated", meetingMinutes: [{ id: result.data!.id }] }));
    setMessage(`${fallbackMessage} 正在打开会议纪要。`);
    router.push(`/meetings/${meeting.id}/review`);
  }

  async function pauseRealtimeTranscription() {
    await stopRealtimeAsr();
    setMessage("已暂停转写。点击“继续实时转写”可以继续录音。");
  }

  async function handlePrimaryWorkflowAction() {
    if (primaryAction.kind === "start") {
      await startRecordingAndTranscription();
      return;
    }
    if (primaryAction.kind === "stop") {
      await stopMeeting();
      return;
    }
    if (primaryAction.kind === "pause") {
      await pauseRealtimeTranscription();
      return;
    }
    if (primaryAction.kind === "generate") {
      await generateMinutesAndOpen();
      return;
    }
    router.push(`/meetings/${meeting.id}/review`);
  }

  if (isUploadMode) {
    const currentStep = hasMinutes ? 3 : segments.length > 0 ? 2 : 1;
    return (
      <div className="space-y-6">
        <section className="grid gap-4 md:grid-cols-3">
          <InfoCard label="会议 ID" value={meeting.id} />
          <InfoCard label="处理方式" value="上传 / 粘贴" />
          <InfoCard label="状态" value={meeting.status} />
        </section>

        {message ? <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">{message}</p> : null}

        <section className="rounded-lg border border-line bg-white p-5">
          <div className="grid gap-3 md:grid-cols-3">
            <FlowStep active={currentStep === 1} done={currentStep > 1} index={1} title="导入材料" />
            <FlowStep active={currentStep === 2} done={currentStep > 2} index={2} title="确认转写" />
            <FlowStep active={currentStep === 3} done={false} index={3} title="生成纪要" />
          </div>
        </section>

        {segments.length === 0 ? (
          <section className="rounded-lg border border-line bg-white">
            <div className="border-b border-line px-6 py-5">
              <h3 className="text-lg font-semibold text-ink">第一步：导入会议材料</h3>
              <p className="mt-2 text-sm leading-6 text-muted">选择一种方式导入原始内容。可以直接粘贴会议文本，也可以上传 md、doc、docx、pdf 附件。</p>
            </div>
            <div className="grid gap-5 p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="rounded-lg border border-line bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-base font-semibold text-ink">粘贴文本</h4>
                    <p className="mt-1 text-sm text-muted">适合已有转写、会议纪要草稿或聊天记录。</p>
                  </div>
                  <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-muted">方式一</span>
                </div>
                <textarea
                  className="min-h-[360px] w-full resize-y rounded-md border border-line bg-white px-4 py-3 text-sm leading-7 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  onChange={(event) => setManualText(event.target.value)}
                  placeholder="粘贴会议转写、会议纪要草稿或材料正文..."
                  value={manualText}
                />
                <div className="mt-4 flex flex-wrap gap-3">
                  <button className="btn-primary disabled:opacity-50" disabled={isBusy || !manualText.trim()} onClick={() => void saveManualTranscript()} type="button">
                    确认导入文本
                  </button>
                  <a className="btn-secondary" href="/dashboard">
                    稍后处理
                  </a>
                </div>
              </div>

              <div className="rounded-lg border border-line bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-base font-semibold text-ink">上传附件</h4>
                    <p className="mt-1 text-sm text-muted">选择文件后自动解析正文。</p>
                  </div>
                  <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-muted">方式二</span>
                </div>
                <label className="flex min-h-[360px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-line bg-white p-8 text-center text-sm text-muted hover:bg-slate-50">
                  <span className="text-base font-semibold text-ink">选择文件</span>
                  <span className="mt-2 block">支持 md / doc / docx / pdf</span>
                  <span className="mt-4 rounded-md bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">上传后自动进入确认转写</span>
                  <input
                    accept=".md,.doc,.docx,.pdf,text/markdown,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
                    className="sr-only"
                    disabled={isBusy}
                    onChange={(event) => {
                      void uploadTranscriptFile(event.target.files?.[0] ?? null);
                      event.currentTarget.value = "";
                    }}
                    type="file"
                  />
                </label>
              </div>
            </div>
          </section>
        ) : (
          <section className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <article className="rounded-lg border border-line bg-white">
              <div className="border-b border-line px-5 py-4">
                <h3 className="text-lg font-semibold text-ink">第二步：确认提取出的转写内容</h3>
                <p className="mt-1 text-sm text-muted">请快速浏览这份原始内容。确认无误后生成会议纪要，正式正文会在纪要页编辑。</p>
              </div>
              <div className="max-h-[760px] overflow-auto bg-slate-50 p-5">
                <div className="rounded-lg border border-line bg-white p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className="rounded-full bg-slate-100 px-2 py-1">已提取 {segments.length} 段</span>
                    {transcriptSources.length > 0 ? <span className="rounded-full bg-slate-100 px-2 py-1">来源：{transcriptSources.join("、")}</span> : null}
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-7 text-ink">{transcriptText}</div>
                </div>
              </div>
            </article>

            <aside className="space-y-4">
              <article className="rounded-lg border border-line bg-white p-5">
                <h3 className="text-base font-semibold text-ink">{hasMinutes ? "第三步：编辑纪要" : "第三步：生成纪要"}</h3>
                <p className="mt-1 text-sm leading-6 text-muted">
                  {hasMinutes ? "纪要已生成，可以进入纪要页编辑正文、生成长图、导出 Word 或发布语雀。" : "确认提取内容后，点击下方按钮调用纪要模型。"}
                </p>
                <div className="mt-4 grid gap-3">
                  <button
                    className="btn-primary disabled:opacity-50"
                    disabled={isGeneratingMinutes}
                    onClick={() => (hasMinutes ? router.push(`/meetings/${meeting.id}/review`) : void generateMinutesAndOpen())}
                    type="button"
                  >
                    {hasMinutes ? "打开纪要编辑" : isGeneratingMinutes ? "正在生成会议纪要..." : "生成会议纪要"}
                  </button>
                  {hasMinutes ? (
                    <button
                      className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-slate-50 disabled:opacity-50"
                      disabled={isGeneratingMinutes}
                      onClick={() => void generateMinutesAndOpen()}
                      type="button"
                    >
                      重新生成会议纪要
                    </button>
                  ) : null}
                </div>
              </article>

              <article className="rounded-lg border border-line bg-white p-5">
                <h3 className="text-base font-semibold text-ink">继续补充材料</h3>
                <textarea
                  className="mt-3 min-h-36 w-full resize-y rounded-md border border-line px-3 py-2 text-sm leading-6 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  onChange={(event) => setManualText(event.target.value)}
                  placeholder="如果还需要追加内容，可以继续粘贴..."
                  value={manualText}
                />
                <button className="mt-3 w-full rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-slate-50 disabled:opacity-50" disabled={isBusy || !manualText.trim()} onClick={() => void saveManualTranscript()} type="button">
                  追加文本
                </button>
                <label className="mt-3 block rounded-md border border-dashed border-line px-4 py-3 text-center text-sm text-muted hover:bg-slate-50">
                  追加附件
                  <input
                    accept=".md,.doc,.docx,.pdf,text/markdown,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
                    className="sr-only"
                    disabled={isBusy}
                    onChange={(event) => {
                      void uploadTranscriptFile(event.target.files?.[0] ?? null);
                      event.currentTarget.value = "";
                    }}
                    type="file"
                  />
                </label>
              </article>
            </aside>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-3">
        <InfoCard label="会议 ID" value={meeting.id} />
        <InfoCard label="处理方式" value="录音转写" />
        <InfoCard label="状态" value={meeting.status} />
      </section>

      {message ? <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">{message}</p> : null}

      <section className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <article className="rounded-lg border border-line bg-white">
          <div className="border-b border-line px-5 py-4">
            <h3 className="text-base font-semibold text-ink">转写文本</h3>
            <p className="mt-1 text-sm text-muted">
              {isUploadMode
                ? "粘贴文本和上传附件会汇总到这里，作为生成会议纪要的原始输入。原始转写不在此处编辑。"
                : "实时录音和粘贴文本都会汇总到这里，作为生成会议纪要的原始输入。原始转写不在此处编辑。"}
            </p>
          </div>
          <div className="min-h-[680px] bg-slate-50 p-5">
            {segments.length === 0 && !partialTranscript ? (
              <div className="flex min-h-[600px] items-center justify-center rounded-lg border border-dashed border-line bg-white px-5 py-8 text-center text-sm text-muted">
                {isUploadMode ? "暂无转写。请在右侧粘贴文本或上传 md、doc、docx、pdf 文件。" : "暂无转写。点击“开始录音并转写”，或使用右侧粘贴文本导入。"}
              </div>
            ) : null}
            {transcriptText || partialTranscript ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-line bg-white p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className="rounded-full bg-slate-100 px-2 py-1">已保存 {segments.length} 段</span>
                    {transcriptSources.length > 0 ? <span className="rounded-full bg-slate-100 px-2 py-1">来源：{transcriptSources.join("、")}</span> : null}
                    {asrStatus === "connected" ? <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">实时接收中</span> : null}
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-7 text-ink">{transcriptText}</div>
                </div>
                {partialTranscript ? (
                  <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
                    <p className="text-xs font-semibold text-blue-700">实时识别中</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-ink">{partialTranscript}</p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </article>

        <aside className="space-y-4">
          {!isUploadMode ? (
          <article className="rounded-lg border border-line bg-white p-5">
            <h3 className="text-base font-semibold text-ink">录音转写</h3>
            <div className="mt-3 space-y-2 rounded-md bg-slate-50 p-3 text-sm text-muted">
              <p>麦克风：{renderMicStatus(micStatus)}</p>
              <p>ASR：{renderAsrStatus(asrStatus)}</p>
              <p>音频包：{chunkCount} 个</p>
              <p>录音片段：{recordingUploadedParts} 个 / {formatFileSize(recordingUploadedBytes)}</p>
              <p className="break-words">录音保存：{recordingUploadStatus}</p>
              <p>当前音量：{volume}%</p>
              <p>峰值音量：{maxVolume}%</p>
              <p className="break-words">最近事件：{lastAsrMessage}</p>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-blue-600" style={{ width: `${volume}%` }} />
              </div>
              {asrStatus === "connected" && chunkCount > 20 && maxVolume <= 1 ? (
                <p className="rounded-md bg-amber-50 px-2 py-1 text-amber-800">当前麦克风输入几乎为静音，请检查浏览器选择的麦克风设备。</p>
              ) : null}
              {partialTranscript ? <p className="leading-6 text-ink">{partialTranscript}</p> : null}
            </div>
            <div className="mt-3 grid gap-2">
              <label className="text-xs font-semibold text-muted" htmlFor="mic-device">
                麦克风设备
              </label>
              <select
                className="rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                disabled={asrStatus === "connected" || asrStatus === "connecting"}
                id="mic-device"
                onChange={(event) => setSelectedMicDeviceId(event.target.value)}
                value={selectedMicDeviceId}
              >
                <option value="">系统默认麦克风（推荐）</option>
                {micDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
              <button
                className="rounded-md border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-slate-50 disabled:opacity-50"
                disabled={asrStatus === "connected" || asrStatus === "connecting"}
                onClick={() => void refreshMicDevices()}
                type="button"
              >
                刷新麦克风列表
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              <button className="btn-primary disabled:opacity-50" disabled={primaryAction.disabled} onClick={() => void handlePrimaryWorkflowAction()} type="button">
                {primaryAction.label}
              </button>
              <button
                className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-slate-50 disabled:opacity-50"
                disabled={asrStatus !== "connected" || primaryAction.kind === "pause"}
                onClick={() => void pauseRealtimeTranscription()}
                type="button"
              >
                暂停转写
              </button>
              <button
                className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-slate-50 disabled:opacity-50"
                disabled={isBusy || meeting.status === "recorded" || hasMinutes || (meeting.status !== "recording" && segments.length === 0)}
                onClick={() => void stopMeeting()}
                type="button"
              >
                结束会议
              </button>
              {hasMinutes && segments.length > 0 ? (
                <button
                  className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-slate-50 disabled:opacity-50"
                  disabled={isGeneratingMinutes}
                  onClick={() => void generateMinutesAndOpen()}
                  type="button"
                >
                  重新生成会议纪要
                </button>
              ) : null}
            </div>
          </article>
          ) : (
          <article className="rounded-lg border border-line bg-white p-5">
            <h3 className="text-base font-semibold text-ink">上传 / 粘贴</h3>
            <p className="mt-1 text-sm leading-6 text-muted">这场会议使用上传/粘贴模式，不显示录音控件。导入文本后手动生成会议纪要。</p>
            <div className="mt-4 grid gap-3">
              <label className="block rounded-md border border-dashed border-line p-4 text-center text-sm text-muted hover:bg-slate-50">
                <span className="font-semibold text-ink">上传附件</span>
                <span className="mt-1 block">支持 md、doc、docx、pdf</span>
                <input
                  accept=".md,.doc,.docx,.pdf,text/markdown,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
                  className="sr-only"
                  disabled={isBusy}
                  onChange={(event) => {
                    void uploadTranscriptFile(event.target.files?.[0] ?? null);
                    event.currentTarget.value = "";
                  }}
                  type="file"
                />
              </label>
              <button
                className="btn-primary disabled:opacity-50"
                disabled={isGeneratingMinutes || (segments.length === 0 && !hasMinutes)}
                onClick={() => (hasMinutes ? router.push(`/meetings/${meeting.id}/review`) : void generateMinutesAndOpen())}
                type="button"
              >
                {hasMinutes ? "查看/编辑纪要" : isGeneratingMinutes ? "正在生成会议纪要..." : "生成会议纪要"}
              </button>
              {hasMinutes && segments.length > 0 ? (
                <button
                  className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-slate-50 disabled:opacity-50"
                  disabled={isGeneratingMinutes}
                  onClick={() => void generateMinutesAndOpen()}
                  type="button"
                >
                  重新生成会议纪要
                </button>
              ) : null}
            </div>
          </article>
          )}

          <article className="rounded-lg border border-line bg-white p-5">
            <h3 className="text-base font-semibold text-ink">粘贴文本导入</h3>
            <p className="mt-1 text-sm leading-6 text-muted">用于已有转写文本或 ASR 异常时的兜底输入。导入后会汇总展示在左侧转写文本中。</p>
            <textarea
              className="mt-4 min-h-48 w-full resize-y rounded-md border border-line px-3 py-2 text-sm leading-6 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              onChange={(event) => setManualText(event.target.value)}
              placeholder="粘贴会议转写文本..."
              value={manualText}
            />
            <button
              className="mt-3 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={isBusy}
              onClick={() => void saveManualTranscript()}
              type="button"
            >
              导入粘贴文本
            </button>
          </article>
        </aside>
      </section>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function FlowStep({ index, title, active, done }: { index: number; title: string; active: boolean; done: boolean }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${active ? "border-blue-500 bg-blue-50" : done ? "border-emerald-200 bg-emerald-50" : "border-line bg-slate-50"}`}>
      <div className="flex items-center gap-3">
        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${active ? "bg-blue-600 text-white" : done ? "bg-emerald-600 text-white" : "bg-white text-muted"}`}>
          {done ? "✓" : index}
        </span>
        <span className="text-sm font-semibold text-ink">{title}</span>
      </div>
    </div>
  );
}

function renderMicStatus(status: MicStatus) {
  const labels = {
    idle: "未启动",
    requesting: "请求授权中",
    active: "已授权",
    failed: "授权失败"
  } as const;
  return labels[status];
}

function renderAsrStatus(status: AsrStatus) {
  const labels = {
    idle: "未连接",
    connecting: "连接中",
    connected: "已连接",
    stopping: "停止中",
    closed: "已关闭",
    failed: "失败"
  } as const;
  return labels[status];
}

function isAsrStatus(value: string | undefined): value is AsrStatus {
  return value === "idle" || value === "connecting" || value === "connected" || value === "stopping" || value === "closed" || value === "failed";
}

function renderTranscriptSource(segment: TranscriptSegment) {
  if (isFileUploadSegment(segment)) {
    return "上传附件";
  }
  return renderProviderName(segment.provider);
}

function isFileUploadSegment(segment: TranscriptSegment) {
  return Boolean(
    segment.rawPayload &&
      typeof segment.rawPayload === "object" &&
      "source" in segment.rawPayload &&
      (segment.rawPayload as { source?: unknown }).source === "file_upload"
  );
}

function renderProviderName(provider: string) {
  const labels: Record<string, string> = {
    doubao_asr: "实时录音",
    manual_paste: "粘贴文本"
  };
  return labels[provider] ?? provider;
}

function getSupportedRecordingMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "video/webm;codecs=opus", "video/webm"];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

function getRecordingExtension(mimeType: string) {
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  }
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function getPrimaryWorkflowAction({
  asrStatus,
  hasMinutes,
  hasTranscript,
  isBusy,
  isGeneratingMinutes,
  meetingStatus
}: {
  asrStatus: AsrStatus;
  hasMinutes: boolean;
  hasTranscript: boolean;
  isBusy: boolean;
  isGeneratingMinutes: boolean;
  meetingStatus: string;
}): { kind: "start" | "pause" | "stop" | "generate" | "open"; label: string; disabled: boolean } {
  if (asrStatus === "connecting") {
    return { kind: "start", label: "正在连接实时转写...", disabled: true };
  }
  if (asrStatus === "connected" || asrStatus === "stopping") {
    return { kind: "pause", label: asrStatus === "stopping" ? "正在暂停转写..." : "暂停转写", disabled: isBusy || asrStatus === "stopping" };
  }
  if (meetingStatus === "recording") {
    return { kind: "start", label: "继续实时转写", disabled: isBusy };
  }
  if (hasMinutes) {
    return { kind: "open", label: "查看/编辑纪要", disabled: false };
  }
  if (meetingStatus === "recorded") {
    return { kind: "generate", label: isGeneratingMinutes ? "正在生成会议纪要..." : "生成会议纪要", disabled: isGeneratingMinutes || !hasTranscript };
  }
  return { kind: "start", label: "开始录音并转写", disabled: isBusy };
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

function buildAsrWebSocketUrl(meetingId: string) {
  return `${apiBaseUrl.replace(/^http/, "ws")}/api/meetings/${meetingId}/asr`;
}

function resampleLinear(input: Float32Array, fromRate: number, toRate: number) {
  if (fromRate === toRate) {
    return input;
  }
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const sourceIndex = index * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(input.length - 1, left + 1);
    const fraction = sourceIndex - left;
    output[index] = (input[left] ?? 0) * (1 - fraction) + (input[right] ?? 0) * fraction;
  }
  return output;
}

function concatFloat32(left: Float32Array, right: Float32Array) {
  const output = new Float32Array(left.length + right.length);
  output.set(left);
  output.set(right, left.length);
  return output;
}

function float32ToPcm16Base64(samples: Float32Array) {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary);
}

function mergeTranscriptSegments(current: TranscriptSegment[], incoming: TranscriptSegment[]) {
  const merged = new Map<string, TranscriptSegment>();
  for (const segment of current) merged.set(segment.id, segment);
  for (const segment of incoming) merged.set(segment.id, segment);
  return sortTranscriptSegments([...merged.values()]);
}

function sortTranscriptSegments(segments: TranscriptSegment[]) {
  return [...segments].sort((left, right) => left.index - right.index);
}
