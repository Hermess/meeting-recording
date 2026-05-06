import { randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import WebSocket from "ws";
import { z } from "zod";

export const DOUBAO_VOLCENGINE_ASR_DOC_URL =
  "https://www.volcengine.com/docs/6561/1354869?lang=zh";

export const DOUBAO_VOLCENGINE_ASR_DEFAULTS = {
  provider: "doubao_volcengine_asr",
  wsUrl: "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async",
  resourceId: "volc.seedasr.sauc.duration",
  sampleRate: 16000,
  audioFormat: "pcm",
  chunkMs: 200,
  enablePunctuation: true,
  docs: DOUBAO_VOLCENGINE_ASR_DOC_URL
} as const;

export const DoubaoVolcengineAsrConfigSchema = z.object({
  provider: z.literal("doubao_volcengine_asr"),
  enabled: z.boolean(),
  wsUrl: z.string().url(),
  appKey: z.string().optional(),
  accessKey: z.string().optional(),
  appId: z.string().optional(),
  accessToken: z.string().optional(),
  secretKey: z.string().optional(),
  appKeyEncrypted: z.string().optional(),
  accessKeyEncrypted: z.string().optional(),
  resourceId: z.string(),
  connectId: z.string().optional(),
  replacementWordId: z.string().optional(),
  personalHotwords: z.array(z.string().trim().min(1)).default([]),
  sampleRate: z.literal(16000),
  audioFormat: z.literal("pcm"),
  chunkMs: z.literal(200),
  enablePunctuation: z.boolean(),
  reconnectAttempts: z.number().int().nonnegative().default(2)
});

export type DoubaoVolcengineAsrConfig = z.infer<typeof DoubaoVolcengineAsrConfigSchema>;

export type AsrConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed" | "failed";

export type AsrTranscriptEvent = {
  type: "transcript";
  text: string;
  isFinal: boolean;
  startMs?: number;
  endMs?: number;
  rawPayload?: unknown;
  logId?: string;
};

export type AsrStatusEvent = {
  type: "status";
  status: AsrConnectionStatus;
  message?: string;
  logId?: string;
};

export type AsrErrorEvent = {
  type: "error";
  code: string;
  message: string;
  retryable: boolean;
  raw?: unknown;
  logId?: string;
};

export type AsrAdapterEvent = AsrTranscriptEvent | AsrStatusEvent | AsrErrorEvent;

export type AsrAudioChunk = {
  meetingId: string;
  sequence: number;
  pcmBase64: string;
  sampleRate: 16000;
  chunkMs: 200;
};

export interface DoubaoVolcengineAsrAdapter {
  readonly status: AsrConnectionStatus;
  connect(config: DoubaoVolcengineAsrConfig): Promise<void>;
  sendAudioChunk(chunk: AsrAudioChunk): Promise<void>;
  close(): Promise<void>;
  onEvent(listener: (event: AsrAdapterEvent) => void): () => void;
}

export class DoubaoVolcengineAsrNotConfiguredError extends Error {
  constructor(message = "Doubao/Volcengine ASR is not configured. Fill ASR credentials before using realtime transcription.") {
    super(message);
    this.name = "DoubaoVolcengineAsrNotConfiguredError";
  }
}

const MESSAGE_TYPE_FULL_CLIENT_REQUEST = 0b0001;
const MESSAGE_TYPE_AUDIO_ONLY_REQUEST = 0b0010;
const MESSAGE_TYPE_FULL_SERVER_RESPONSE = 0b1001;
const MESSAGE_TYPE_ERROR_RESPONSE = 0b1111;
const MESSAGE_FLAG_NONE = 0b0000;
const MESSAGE_FLAG_LAST_PACKET = 0b0010;
const SERIALIZATION_JSON = 0b0001;
const SERIALIZATION_NONE = 0b0000;
const COMPRESSION_GZIP = 0b0001;

export class VolcengineStreamingAsrAdapter implements DoubaoVolcengineAsrAdapter {
  private socket: WebSocket | null = null;
  private listeners = new Set<(event: AsrAdapterEvent) => void>();
  private currentStatus: AsrConnectionStatus = "idle";
  private logId: string | undefined;
  private closeRequested = false;
  private responseFrameCount = 0;
  private emptyTranscriptFrameCount = 0;

  get status() {
    return this.currentStatus;
  }

  async connect(config: DoubaoVolcengineAsrConfig): Promise<void> {
    const parsed = DoubaoVolcengineAsrConfigSchema.parse(config);
    const appKey = resolveCredential(parsed.appKey ?? parsed.appId, parsed.appKeyEncrypted);
    const accessKey = resolveCredential(parsed.accessKey ?? parsed.accessToken ?? parsed.secretKey, parsed.accessKeyEncrypted);
    if (!parsed.enabled) {
      throw new DoubaoVolcengineAsrNotConfiguredError("豆包/火山 ASR 未启用，请先开启 DOUBAO_VOLCENGINE_ASR_ENABLED。");
    }
    if (!appKey || !accessKey) {
      throw new DoubaoVolcengineAsrNotConfiguredError("豆包/火山 ASR 缺少 app key 或 access key。");
    }

    this.closeRequested = false;
    this.setStatus("connecting", "正在连接豆包/火山 ASR");
    const connectId = parsed.connectId || randomUUID();

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(parsed.wsUrl, {
        headers: {
          "X-Api-App-Key": appKey,
          "X-Api-Access-Key": accessKey,
          "X-Api-Resource-Id": parsed.resourceId,
          "X-Api-Connect-Id": connectId
        }
      });
      this.socket = socket;

      socket.once("open", () => {
        socket.send(buildFullClientRequest(parsed));
        this.setStatus("connected", "豆包/火山 ASR 已连接");
        resolve();
      });

      socket.once("error", (error) => {
        this.setStatus("failed", "豆包/火山 ASR 连接失败");
        reject(error);
      });

      socket.on("message", (data) => this.handleMessage(data));
      socket.on("close", (code, reason) => {
        const message = reason.length > 0 ? reason.toString("utf8") : `connection closed: ${code}`;
        this.setStatus(this.closeRequested ? "closed" : "failed", message);
      });
    });
  }

  async sendAudioChunk(chunk: AsrAudioChunk): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.emit(withLogId({
        type: "error",
        code: "asr_socket_not_open",
        message: "豆包/火山 ASR WebSocket 尚未连接。",
        retryable: true
      }, this.logId));
      return;
    }

    if (chunk.sampleRate !== 16000 || chunk.chunkMs !== 200) {
      this.emit(withLogId({
        type: "error",
        code: "invalid_audio_chunk",
        message: "音频块必须是 16k PCM，200ms 分包。",
        retryable: false,
        raw: { sampleRate: chunk.sampleRate, chunkMs: chunk.chunkMs }
      }, this.logId));
      return;
    }

    const audio = Buffer.from(chunk.pcmBase64, "base64");
    this.socket.send(buildAudioOnlyRequest(audio, false));
  }

  async close(): Promise<void> {
    this.closeRequested = true;
    const socket = this.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(buildAudioOnlyRequest(Buffer.alloc(0), true));
      await delay(1200);
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(1000, "client closed");
      }
    }
    this.socket = null;
    this.setStatus("closed", "豆包/火山 ASR 已关闭");
  }

  onEvent(listener: (event: AsrAdapterEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private handleMessage(data: WebSocket.RawData) {
    try {
      const buffer = rawDataToBuffer(data);
      const parsed = parseServerFrame(buffer);
      if (parsed.messageType === MESSAGE_TYPE_ERROR_RESPONSE) {
        this.emit(withLogId({
          type: "error",
          code: `volcengine_${parsed.errorCode ?? "error"}`,
          message: parsed.payloadText || "豆包/火山 ASR 返回错误。",
          retryable: true,
          raw: parsed.payload
        }, this.logId));
        return;
      }

      if (parsed.messageType !== MESSAGE_TYPE_FULL_SERVER_RESPONSE) {
        return;
      }

      this.responseFrameCount += 1;
      const events = extractTranscriptEvents(parsed.payload);
      if (events.length === 0) {
        this.emptyTranscriptFrameCount += 1;
        if (this.emptyTranscriptFrameCount === 1 || this.emptyTranscriptFrameCount % 5 === 0) {
          this.emit(withLogId({
            type: "status",
            status: "connected",
            message: `豆包/火山 ASR 已返回 ${this.responseFrameCount} 帧，但暂未识别出文字。`
          }, this.logId));
        }
        return;
      }

      for (const event of events) {
        this.emit(withLogId(event, this.logId));
      }
    } catch (error) {
      this.emit(withLogId({
        type: "error",
        code: "asr_response_parse_failed",
        message: error instanceof Error ? error.message : "豆包/火山 ASR 响应解析失败。",
        retryable: true
      }, this.logId));
    }
  }

  private setStatus(status: AsrConnectionStatus, message?: string) {
    this.currentStatus = status;
    this.emit(withOptionalFields({ type: "status", status }, { message, logId: this.logId }));
  }

  private emit(event: AsrAdapterEvent) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export class PlaceholderDoubaoVolcengineAsrAdapter implements DoubaoVolcengineAsrAdapter {
  readonly status: AsrConnectionStatus = "idle";

  async connect(): Promise<void> {
    throw new DoubaoVolcengineAsrNotConfiguredError();
  }

  async sendAudioChunk(): Promise<void> {
    throw new DoubaoVolcengineAsrNotConfiguredError();
  }

  async close(): Promise<void> {
    return;
  }

  onEvent(): () => void {
    return () => undefined;
  }
}

function buildFullClientRequest(config: DoubaoVolcengineAsrConfig) {
  const personalHotwords = (config.personalHotwords ?? [])
    .map((word) => word.trim())
    .filter(Boolean)
    .map((word) => ({ word }));
  const payload = {
    user: {
      uid: "meeting-ai-kit"
    },
    audio: {
      format: config.audioFormat,
      codec: "raw",
      rate: config.sampleRate,
      bits: 16,
      channel: 1
    },
    request: {
      model_name: "bigmodel",
      enable_punc: config.enablePunctuation,
      show_utterances: true,
      result_type: "full",
      ...(personalHotwords.length > 0 ? { hotwords: personalHotwords } : {}),
      ...(config.replacementWordId ? { replacement_word_id: config.replacementWordId, boosting_table_id: config.replacementWordId } : {})
    }
  };
  const body = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
  return concatHeaderAndPayload(
    makeHeader(MESSAGE_TYPE_FULL_CLIENT_REQUEST, MESSAGE_FLAG_NONE, SERIALIZATION_JSON, COMPRESSION_GZIP),
    body
  );
}

function buildAudioOnlyRequest(audio: Buffer, isLast: boolean) {
  const body = gzipSync(audio);
  return concatHeaderAndPayload(
    makeHeader(
      MESSAGE_TYPE_AUDIO_ONLY_REQUEST,
      isLast ? MESSAGE_FLAG_LAST_PACKET : MESSAGE_FLAG_NONE,
      SERIALIZATION_NONE,
      COMPRESSION_GZIP
    ),
    body
  );
}

function makeHeader(messageType: number, flags: number, serialization: number, compression: number) {
  return Buffer.from([(1 << 4) | 1, (messageType << 4) | flags, (serialization << 4) | compression, 0]);
}

function concatHeaderAndPayload(header: Buffer, payload: Buffer) {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, size, payload]);
}

type ParsedServerFrame = {
  messageType: number;
  flags: number;
  payload: unknown;
  payloadText?: string;
  errorCode?: number;
};

function parseServerFrame(buffer: Buffer): ParsedServerFrame {
  if (buffer.length < 8) {
    throw new Error("ASR response frame is too short.");
  }

  const firstByte = buffer[0];
  const secondByte = buffer[1];
  const thirdByte = buffer[2];
  if (firstByte === undefined || secondByte === undefined || thirdByte === undefined) {
    throw new Error("ASR response header is incomplete.");
  }
  const headerSize = (firstByte & 0x0f) * 4;
  const messageType = secondByte >> 4;
  const flags = secondByte & 0x0f;
  const serialization = thirdByte >> 4;
  const compression = thirdByte & 0x0f;

  if (messageType === MESSAGE_TYPE_ERROR_RESPONSE) {
    const candidates = [headerSize + 4, headerSize];
    for (const offset of candidates) {
      const parsed = tryReadPayload(buffer, offset, serialization, compression);
      if (parsed) {
        const frame: ParsedServerFrame = {
          messageType,
          flags,
          payload: parsed.payload,
          payloadText: parsed.payloadText
        };
        if (offset !== headerSize) {
          frame.errorCode = buffer.readInt32BE(headerSize);
        }
        return frame;
      }
    }
  }

  for (const offset of [headerSize + 4, headerSize]) {
    const parsed = tryReadPayload(buffer, offset, serialization, compression);
    if (parsed) {
      return { messageType, flags, payload: parsed.payload, payloadText: parsed.payloadText };
    }
  }

  throw new Error("Unable to parse ASR response payload.");
}

function tryReadPayload(buffer: Buffer, sizeOffset: number, serialization: number, compression: number) {
  if (sizeOffset + 4 > buffer.length) {
    return null;
  }

  const size = buffer.readUInt32BE(sizeOffset);
  const payloadStart = sizeOffset + 4;
  const payloadEnd = payloadStart + size;
  if (size < 0 || payloadEnd > buffer.length) {
    return null;
  }

  const compressedPayload = buffer.subarray(payloadStart, payloadEnd);
  const payloadBuffer = compression === COMPRESSION_GZIP ? gunzipSync(compressedPayload) : compressedPayload;
  const payloadText = payloadBuffer.toString("utf8");
  const payload = serialization === SERIALIZATION_JSON ? JSON.parse(payloadText) : payloadText;
  return { payload, payloadText };
}

function extractTranscriptEvents(payload: unknown): AsrTranscriptEvent[] {
  const result = readObject(payload, "result") ?? readObject(payload, "payload") ?? asRecord(payload);
  const utterances = readArray(result, "utterances");
  const results = readArray(result, "results");
  const segments = readArray(result, "segments");
  const candidates =
    utterances.length > 0
      ? utterances
      : results.length > 0
        ? results
        : segments.length > 0
          ? segments
          : result
            ? [result]
            : [];

  const events: AsrTranscriptEvent[] = [];
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (!record) {
      continue;
    }
    const text = readFirstString(record, ["text", "result_text", "utterance", "sentence"]);
    if (!text) {
      continue;
    }
    events.push(withOptionalFields({
      type: "transcript",
      text,
      isFinal: readBoolean(record, ["definite", "is_final", "final"]) ?? readBoolean(asRecord(payload), ["definite", "is_final", "final"]) ?? false,
      rawPayload: payload
    }, {
      startMs: readNumber(record, ["start_time", "startMs", "start_ms"]),
      endMs: readNumber(record, ["end_time", "endMs", "end_ms"])
    }));
  }

  if (events.length > 0) {
    return events;
  }

  const text = deepFindString(payload, ["text", "result_text"]);
  return text
    ? [
        {
          type: "transcript",
          text,
          isFinal: readBoolean(asRecord(payload), ["definite", "is_final", "final"]) ?? false,
          rawPayload: payload
        }
      ]
    : [];
}

function rawDataToBuffer(data: WebSocket.RawData) {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function resolveCredential(plain?: string, encrypted?: string) {
  return (plain || encrypted || "").trim();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function readObject(value: unknown, key: string) {
  const record = asRecord(value);
  return record ? asRecord(record[key]) : undefined;
}

function readArray(value: unknown, key: string) {
  const record = asRecord(value);
  const candidate = record?.[key];
  return Array.isArray(candidate) ? candidate : [];
}

function readFirstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readBoolean(record: Record<string, unknown> | undefined, keys: string[]) {
  if (!record) return undefined;
  for (const key of keys) {
    if (typeof record[key] === "boolean") {
      return record[key] as boolean;
    }
  }
  return undefined;
}

function readNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.round(value));
    }
  }
  return undefined;
}

function deepFindString(value: unknown, keys: string[]): string | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const direct = readFirstString(record, keys);
  if (direct) {
    return direct;
  }
  for (const child of Object.values(record)) {
    const nested = deepFindString(child, keys);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

function withLogId<T extends AsrAdapterEvent>(event: T, logId: string | undefined): T {
  return withOptionalFields(event, { logId });
}

function withOptionalFields<T extends Record<string, unknown>>(base: T, fields: Record<string, unknown | undefined>) {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
