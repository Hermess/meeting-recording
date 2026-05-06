import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  DOUBAO_VOLCENGINE_ASR_DEFAULTS,
  VolcengineStreamingAsrAdapter,
  type AsrAdapterEvent,
  type AsrAudioChunk,
  type AsrTranscriptEvent
} from "@meeting-ai-kit/asr-adapter";
import { prisma } from "../prisma.js";
import { getAuthContext, scopedMeetingWhere } from "../services/auth.js";
import { buildAsrAdapterConfig } from "../services/runtime-config.js";
import { compactTranscriptTexts, createTranscriptDeduper } from "../services/transcript-dedupe.js";

const AsrParamsSchema = z.object({
  id: z.string().min(1)
});

const ClientAudioChunkSchema = z.object({
  type: z.literal("audio_chunk"),
  sequence: z.number().int().nonnegative(),
  audio: z.string().min(1),
  sampleRate: z.literal(16000),
  chunkMs: z.literal(200)
});

const ClientFinishMessageSchema = z.object({
  type: z.literal("finish")
});

const ClientAsrMessageSchema = z.discriminatedUnion("type", [ClientAudioChunkSchema, ClientFinishMessageSchema]);

export async function registerAsrRoutes(app: FastifyInstance) {
  app.get("/meetings/:id/asr", { websocket: true }, async (socket, request) => {
    const parsed = AsrParamsSchema.safeParse(request.params);
    const meetingId = parsed.success ? parsed.data.id : "unknown";
    const auth = await getAuthContext(request);

    if (auth.enabled && !auth.user) {
      socket.send(
        JSON.stringify({
          type: "error",
          code: "unauthorized",
          meetingId,
          retryable: false,
          message: "请先使用钉钉扫码登录，再开始实时转写。"
        })
      );
      socket.close(1008, "unauthorized");
      return;
    }

    const meeting = parsed.success
      ? await prisma.meeting.findFirst({
          where: scopedMeetingWhere(auth, meetingId),
          select: { id: true, status: true }
        })
      : null;

    if (!meeting) {
      socket.send(
        JSON.stringify({
          type: "error",
          code: "meeting_not_found",
          meetingId,
          retryable: false,
          message: "会议不存在，无法开始实时转写。"
        })
      );
      socket.close(1008, "meeting not found");
      return;
    }

    const config = await buildAsrAdapterConfig(auth.user?.id);
    if (!config.enabled || !(config.appKey || config.appKeyEncrypted) || !(config.accessKey || config.accessKeyEncrypted)) {
      socket.send(
        JSON.stringify({
          type: "error",
          code: "asr_not_configured",
          meetingId,
          retryable: false,
          message: "豆包/火山 ASR 未启用或缺少凭证。请在设置页完成配置，或使用粘贴转写兜底。",
          provider: DOUBAO_VOLCENGINE_ASR_DEFAULTS.provider,
          docs: DOUBAO_VOLCENGINE_ASR_DEFAULTS.docs
        })
      );
      socket.close(1013, "asr not configured");
      return;
    }

    const adapter = new VolcengineStreamingAsrAdapter();
    let nextIndex = await getNextTranscriptIndex(meetingId);
    let lastFinalText = "";
    let latestPartialEvent: AsrTranscriptEvent | null = null;
    let savedFinalCount = 0;
    let duplicateFinalCount = 0;
    let receivedAudioChunks = 0;
    let maxAudioRms = 0;
    let finalizeStarted = false;
    const pendingPersistOperations: Array<Promise<void>> = [];
    const finalDeduper = createTranscriptDeduper(compactTranscriptTexts(await getExistingAsrTranscriptTexts(meetingId)));

    const unsubscribe = adapter.onEvent((event) => {
      if (event.type === "transcript" && event.isFinal) {
        const acceptedText = finalDeduper.acceptFinal(event.text);
        if (!acceptedText) {
          duplicateFinalCount += 1;
          if (duplicateFinalCount === 1 || duplicateFinalCount % 10 === 0) {
            safeSocketSend(socket, {
              type: "status",
              status: "asr_duplicate_ignored",
              meetingId,
              message: `已忽略 ${duplicateFinalCount} 条重复 ASR 候选。`
            });
          }
          return;
        }

        const persistOperation = persistFinalTranscript(meetingId, { ...event, text: acceptedText }, nextIndex++).then((segment) => {
          lastFinalText = segment.text;
          savedFinalCount += 1;
          safeSocketSend(socket, {
            type: "transcript",
            meetingId,
            segment
          });
          safeSocketSend(socket, {
            type: "status",
            status: "asr_final_saved",
            meetingId,
            message: `已保存最终转写 #${segment.index + 1}`
          });
        });
        pendingPersistOperations.push(persistOperation);
        return;
      }

      if (event.type === "transcript") {
        latestPartialEvent = event;
        if (event.text === lastFinalText) {
          return;
        }
        safeSocketSend(socket, {
          type: "transcript",
          meetingId,
          text: event.text,
          isFinal: false,
          startMs: event.startMs,
          endMs: event.endMs,
          logId: event.logId
        });
        safeSocketSend(socket, {
          type: "status",
          status: "asr_partial",
          meetingId,
          message: `收到临时识别：${event.text.slice(0, 40)}`
        });
        return;
      }

      safeSocketSend(socket, { ...event, meetingId });
    });

    try {
      await prisma.meeting.update({
        where: { id: meetingId },
        data: { status: "recording", lastError: null }
      });
      await adapter.connect(config);
      socket.send(
        JSON.stringify({
          type: "status",
          status: "connected",
          meetingId,
          message: "实时转写已连接。"
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "豆包/火山 ASR 连接失败。";
      await prisma.meeting.update({
        where: { id: meetingId },
        data: { status: "failed", lastError: message }
      });
      socket.send(
        JSON.stringify({
          type: "error",
          code: "asr_connect_failed",
          meetingId,
          retryable: true,
          message,
          docs: DOUBAO_VOLCENGINE_ASR_DEFAULTS.docs
        })
      );
      socket.close(1011, "asr connect failed");
      unsubscribe();
      return;
    }

    socket.on("message", (raw) => {
      const parsedMessage = parseClientMessage(raw);
      if (!parsedMessage.success) {
        socket.send(
          JSON.stringify({
            type: "error",
            code: "invalid_asr_client_message",
            meetingId,
            retryable: false,
            message: parsedMessage.error
          })
        );
        return;
      }

      if (parsedMessage.data.type === "finish") {
        void finalizeAsrSession("client_finish", true);
        return;
      }

      const chunk: AsrAudioChunk = {
        meetingId,
        sequence: parsedMessage.data.sequence,
        pcmBase64: parsedMessage.data.audio,
        sampleRate: parsedMessage.data.sampleRate,
        chunkMs: parsedMessage.data.chunkMs
      };
      receivedAudioChunks += 1;
      maxAudioRms = Math.max(maxAudioRms, calculatePcm16Rms(parsedMessage.data.audio));
      if (receivedAudioChunks === 1 || receivedAudioChunks % 5 === 0) {
        safeSocketSend(socket, {
          type: "status",
          status: "audio_received",
          meetingId,
          message: `后端已收到 ${receivedAudioChunks} 个音频包，峰值音量 ${Math.round(maxAudioRms * 100)}%`
        });
      }
      void adapter.sendAudioChunk(chunk);
    });

    socket.on("close", () => {
      void finalizeAsrSession("socket_close", false);
    });

    async function finalizeAsrSession(reason: string, closeSocket: boolean) {
      if (finalizeStarted) {
        return;
      }
      finalizeStarted = true;
      safeSocketSend(socket, {
        type: "status",
        status: "finalizing",
        meetingId,
        message: "正在收尾实时转写，等待最终识别结果..."
      });
      try {
        await adapter.close();
        await Promise.allSettled(pendingPersistOperations);
        if (latestPartialEvent && shouldFlushPartial(latestPartialEvent.text, lastFinalText)) {
          const acceptedText = finalDeduper.acceptFinal(latestPartialEvent.text);
          if (acceptedText) {
            const segment = await persistFinalTranscript(meetingId, { ...latestPartialEvent, text: acceptedText, isFinal: true }, nextIndex++);
            lastFinalText = segment.text;
            savedFinalCount += 1;
            safeSocketSend(socket, {
              type: "transcript",
              meetingId,
              segment
            });
          }
        }
        if (savedFinalCount === 0 && !latestPartialEvent) {
          safeSocketSend(socket, {
            type: "status",
            status: "no_transcript",
            meetingId,
            message:
              maxAudioRms < 0.015
                ? `已收到 ${receivedAudioChunks} 个音频包，但音量过低，ASR 未识别到有效语音。请检查 Chrome 麦克风输入设备或提高说话音量。`
                : `已收到 ${receivedAudioChunks} 个音频包，音量正常，但 ASR 未返回文字。请稍后重试或检查火山 ASR 返回格式。`
          });
        }
        safeSocketSend(socket, {
          type: "status",
          status: "finalized",
          meetingId,
          message: `实时转写已收尾，共收到 ${receivedAudioChunks} 个音频包。`,
          reason
        });
      } finally {
        unsubscribe();
        if (closeSocket && socket.readyState === 1) {
          socket.close(1000, "asr finalized");
        }
      }
    }
  });
}

async function getNextTranscriptIndex(meetingId: string) {
  const latest = await prisma.transcriptSegment.findFirst({
    where: { meetingId },
    orderBy: { index: "desc" },
    select: { index: true }
  });
  return (latest?.index ?? -1) + 1;
}

async function getExistingAsrTranscriptTexts(meetingId: string) {
  const rows = await prisma.transcriptSegment.findMany({
    where: { meetingId, provider: "doubao_asr", isFinal: true },
    orderBy: { index: "asc" },
    select: { text: true }
  });
  return rows.map((row) => row.text);
}

async function persistFinalTranscript(meetingId: string, event: AsrTranscriptEvent, index: number) {
  const created = await prisma.transcriptSegment.create({
    data: {
      meetingId,
      index,
      text: event.text,
      isFinal: true,
      provider: "doubao_asr",
      ...(event.startMs !== undefined ? { startMs: event.startMs } : {}),
      ...(event.endMs !== undefined ? { endMs: event.endMs } : {}),
      ...(event.rawPayload !== undefined ? { rawPayload: toJson(event.rawPayload) } : {})
    }
  });

  return {
    ...created,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString()
  };
}

function parseClientMessage(raw: unknown) {
  try {
    const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
    const payload = JSON.parse(text) as unknown;
    const parsed = ClientAsrMessageSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        success: false as const,
        error: parsed.error.issues.map((issue) => issue.message).join("; ")
      };
    }
    return {
      success: true as const,
      data: parsed.data
    };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "客户端 ASR 消息解析失败。"
    };
  }
}

function toJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function safeSocketSend(socket: { readyState: number; send(data: string): void }, payload: unknown) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(payload));
  }
}

function shouldFlushPartial(partialText: string, finalText: string) {
  if (!partialText) {
    return false;
  }
  if (!finalText) {
    return true;
  }
  return !finalText.includes(partialText) && !partialText.includes(finalText);
}

function calculatePcm16Rms(base64Audio: string) {
  const buffer = Buffer.from(base64Audio, "base64");
  if (buffer.length < 2) {
    return 0;
  }
  let sum = 0;
  let count = 0;
  for (let offset = 0; offset + 1 < buffer.length; offset += 2) {
    const sample = buffer.readInt16LE(offset) / 32768;
    sum += sample * sample;
    count += 1;
  }
  return count > 0 ? Math.sqrt(sum / count) : 0;
}
