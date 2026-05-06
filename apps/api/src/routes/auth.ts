import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { clearSession, createSession, getAuthContext, isAuthEnabled } from "../services/auth.js";
import { authenticateEmailUser, registerEmailUser, requestEmailCode, resetEmailPassword } from "../services/email-auth.js";

const EmailCodeSchema = z.object({
  email: z.string().email(),
  purpose: z.enum(["register", "reset_password"])
});

const RegisterSchema = z.object({
  email: z.string().email(),
  code: z.string().min(4),
  password: z.string().min(8)
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const ResetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().min(4),
  password: z.string().min(8)
});

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get("/me", async (request) => {
    const context = await getAuthContext(request);
    return {
      data: {
        authenticated: Boolean(context.user),
        authEnabled: context.enabled,
        authProvider: "email",
        dingTalkConfigured: false,
        user: context.user
      }
    };
  });

  app.post("/email-code", async (request, reply) => {
    const parsed = EmailCodeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_email_code_request",
        message: "请输入有效邮箱并选择验证码用途。"
      });
    }

    try {
      const result = await requestEmailCode(parsed.data);
      return {
        data: {
          email: result.email,
          expiresAt: result.expiresAt,
          ...(result.devCode ? { devCode: result.devCode } : {})
        }
      };
    } catch (error) {
      return reply.code(400).send({
        error: "email_code_failed",
        message: error instanceof Error ? error.message : "验证码发送失败"
      });
    }
  });

  app.post("/register", async (request, reply) => {
    const parsed = RegisterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_register_request",
        message: "请输入有效邮箱、验证码和至少 8 位密码。"
      });
    }

    try {
      const user = await registerEmailUser(parsed.data);
      await claimLegacyData(user.id);
      await createSession(reply, user.id);
      return { data: { user: publicUser(user) } };
    } catch (error) {
      return reply.code(400).send({
        error: "register_failed",
        message: error instanceof Error ? error.message : "注册失败"
      });
    }
  });

  app.post("/login", async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_login_request",
        message: "请输入有效邮箱和密码。"
      });
    }

    try {
      const user = await authenticateEmailUser(parsed.data);
      await createSession(reply, user.id);
      return { data: { user: publicUser(user) } };
    } catch (error) {
      return reply.code(401).send({
        error: "login_failed",
        message: error instanceof Error ? error.message : "登录失败"
      });
    }
  });

  app.post("/reset-password", async (request, reply) => {
    const parsed = ResetPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_reset_password_request",
        message: "请输入有效邮箱、验证码和至少 8 位新密码。"
      });
    }

    try {
      await resetEmailPassword(parsed.data);
      return { data: { ok: true } };
    } catch (error) {
      return reply.code(400).send({
        error: "reset_password_failed",
        message: error instanceof Error ? error.message : "重置密码失败"
      });
    }
  });

  app.post("/logout", async (request, reply) => {
    await clearSession(request, reply);
    return { data: { ok: true } };
  });

  app.get("/status", async () => ({
    data: {
      authEnabled: isAuthEnabled(),
      authProvider: "email"
    }
  }));
}

async function claimLegacyData(userId: string) {
  const ownedCount = await prisma.meeting.count({ where: { ownerUserId: userId } });
  const anyOwnedCount = await prisma.meeting.count({ where: { ownerUserId: { not: null } } });
  if (ownedCount === 0 && anyOwnedCount === 0) {
    await prisma.meeting.updateMany({
      where: { ownerUserId: null },
      data: { ownerUserId: userId }
    });
  }

  const ownedModelCount = await prisma.modelConfig.count({ where: { ownerUserId: userId } });
  const anyOwnedModelCount = await prisma.modelConfig.count({ where: { ownerUserId: { not: null } } });
  if (ownedModelCount === 0 && anyOwnedModelCount === 0) {
    await prisma.modelConfig.updateMany({
      where: { ownerUserId: null },
      data: { ownerUserId: userId }
    });
  }

  const ownedMeetingTypeCount = await prisma.meetingTypeConfig.count({ where: { ownerUserId: userId } });
  const anyOwnedMeetingTypeCount = await prisma.meetingTypeConfig.count({ where: { ownerUserId: { not: null } } });
  if (ownedMeetingTypeCount === 0 && anyOwnedMeetingTypeCount === 0) {
    await prisma.meetingTypeConfig.updateMany({
      where: { ownerUserId: null },
      data: { ownerUserId: userId }
    });
  }
}

function publicUser(user: { avatarUrl?: string | null; email?: string | null; id: string; name: string }) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl
  };
}
