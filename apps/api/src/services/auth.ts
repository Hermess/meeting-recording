import type { FastifyReply, FastifyRequest } from "fastify";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../prisma.js";

export const AUTH_COOKIE_NAME = "meeting_ai_session";
const SESSION_TTL_DAYS = Number(process.env.AUTH_SESSION_TTL_DAYS ?? 14);

export type AuthUser = {
  id: string;
  name: string;
  provider: string;
  providerUserId: string;
  email?: string | null;
  avatarUrl?: string | null;
};

export type AuthContext = {
  enabled: boolean;
  user: AuthUser | null;
};

export function isAuthEnabled() {
  return process.env.AUTH_DISABLED !== "true";
}

export async function getAuthContext(request: FastifyRequest): Promise<AuthContext> {
  if (!isAuthEnabled()) {
    return { enabled: false, user: null };
  }

  if (isInternalRequest(request)) {
    return { enabled: false, user: null };
  }

  const token = parseCookie(request.headers.cookie ?? "")[AUTH_COOKIE_NAME];
  if (!token) {
    return { enabled: true, user: null };
  }

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true }
  });

  if (!session || session.expiresAt.getTime() <= Date.now() || !session.user.isActive) {
    return { enabled: true, user: null };
  }

  await prisma.authSession.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() }
  });

  return {
    enabled: true,
    user: {
      id: session.user.id,
      name: session.user.name,
      provider: session.user.provider,
      providerUserId: session.user.providerUserId,
      email: session.user.email,
      avatarUrl: session.user.avatarUrl
    }
  };
}

export async function requireAuthContext(request: FastifyRequest, reply: FastifyReply) {
  const context = await getAuthContext(request);
  if (context.enabled && !context.user) {
    reply.code(401).send({
      error: "unauthorized",
      message: "请先登录账号。"
    });
    return null;
  }
  return context;
}

export function scopedMeetingWhere(context: AuthContext, id?: string) {
  return {
    ...(id ? { id } : {}),
    ...(context.enabled && context.user ? { ownerUserId: context.user.id } : {})
  };
}

export async function createSession(reply: FastifyReply, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.authSession.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt
    }
  });
  reply.header("set-cookie", serializeCookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    secure: process.env.AUTH_COOKIE_SECURE === "true"
  }));
}

export async function clearSession(request: FastifyRequest, reply: FastifyReply) {
  const token = parseCookie(request.headers.cookie ?? "")[AUTH_COOKIE_NAME];
  if (token) {
    await prisma.authSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  reply.header("set-cookie", serializeCookie(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 0,
    secure: process.env.AUTH_COOKIE_SECURE === "true"
  }));
}

export function createSignedState(input: { redirectPath: string; embedded?: boolean }) {
  const payload = Buffer.from(JSON.stringify({
    redirectPath: sanitizeRedirectPath(input.redirectPath),
    embedded: Boolean(input.embedded),
    nonce: randomBytes(12).toString("base64url"),
    ts: Date.now()
  })).toString("base64url");
  const signature = signStatePayload(payload);
  return `${payload}.${signature}`;
}

export function verifySignedState(state: string) {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) {
    throw new Error("登录状态校验失败，请重新扫码。");
  }
  const expected = signStatePayload(payload);
  if (!safeEqual(signature, expected)) {
    throw new Error("登录状态签名无效，请重新扫码。");
  }
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { embedded?: boolean; redirectPath?: string; ts?: number };
  if (typeof parsed.ts !== "number" || Date.now() - parsed.ts > 10 * 60 * 1000) {
    throw new Error("登录状态已过期，请重新扫码。");
  }
  return {
    embedded: Boolean(parsed.embedded),
    redirectPath: sanitizeRedirectPath(parsed.redirectPath ?? "/dashboard")
  };
}

export function sanitizeRedirectPath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function signStatePayload(payload: string) {
  return createHmac("sha256", process.env.AUTH_SESSION_SECRET || process.env.EMAIL_CODE_SECRET || process.env.DINGTALK_CLIENT_SECRET || "meeting-ai-kit-dev-secret")
    .update(payload)
    .digest("base64url");
}

function isInternalRequest(request: FastifyRequest) {
  const configuredToken = process.env.INTERNAL_RENDER_TOKEN || process.env.AUTH_SESSION_SECRET;
  const incomingToken = request.headers["x-meeting-ai-internal-token"];
  return Boolean(configuredToken && typeof incomingToken === "string" && safeEqual(incomingToken, configuredToken));
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookie(cookieHeader: string) {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        if (index < 0) return [item, ""];
        return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
      })
  );
}

function serializeCookie(
  name: string,
  value: string,
  options: { httpOnly: boolean; sameSite: "Lax" | "Strict" | "None"; path: string; maxAge: number; secure: boolean }
) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    `SameSite=${options.sameSite}`
  ];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}
