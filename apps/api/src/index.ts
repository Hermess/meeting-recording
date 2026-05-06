import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { registerAsrRoutes } from "./routes/asr.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerMeetingRoutes } from "./routes/meetings.js";
import { registerMinutesRoutes } from "./routes/minutes.js";
import { registerFeishuPublishRoutes } from "./routes/publish-feishu.js";
import { registerYuquePublishRoutes } from "./routes/publish-yuque.js";
import { registerTranscriptRoutes } from "./routes/transcripts.js";
import { registerVisualReportRoutes } from "./routes/visual-reports.js";
import { getStorageRoot } from "./utils/paths.js";

const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? "0.0.0.0";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info"
  }
});

await app.register(cors, {
  origin: true,
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"]
});
await app.register(websocket);
await app.register(multipart, {
  limits: {
    fileSize: 300 * 1024 * 1024,
    files: 1
  }
});
await app.register(fastifyStatic, {
  root: getStorageRoot(),
  prefix: "/storage/"
});

app.get("/health", async () => ({
  ok: true,
  service: "meeting-ai-kit-api",
  version: "0.1.0"
}));

await app.register(registerConfigRoutes, { prefix: "/api/config" });
await app.register(registerAuthRoutes, { prefix: "/api/auth" });
await app.register(registerMeetingRoutes, { prefix: "/api" });
await app.register(registerTranscriptRoutes, { prefix: "/api" });
await app.register(registerAsrRoutes, { prefix: "/api" });
await app.register(registerMinutesRoutes, { prefix: "/api" });
await app.register(registerVisualReportRoutes, { prefix: "/api" });
await app.register(registerFeishuPublishRoutes, { prefix: "/api" });
await app.register(registerYuquePublishRoutes, { prefix: "/api" });

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
