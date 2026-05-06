import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import nodemailer from "nodemailer";
import { prisma } from "../prisma.js";

const scrypt = promisify(scryptCallback);
const CODE_TTL_MINUTES = Number(process.env.EMAIL_CODE_TTL_MINUTES ?? 10);
const CODE_RESEND_SECONDS = Number(process.env.EMAIL_CODE_RESEND_SECONDS ?? 60);
const PASSWORD_MIN_LENGTH = Number(process.env.PASSWORD_MIN_LENGTH ?? 8);

export type EmailCodePurpose = "register" | "reset_password";

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function requestEmailCode(input: { email: string; purpose: EmailCodePurpose }) {
  const email = normalizeEmail(input.email);
  validateEmail(email);

  const existingUser = await findEmailUser(email);
  if (input.purpose === "register" && existingUser?.passwordHash) {
    throw new Error("该邮箱已注册，请直接登录。");
  }
  if (input.purpose === "reset_password" && !existingUser?.passwordHash) {
    throw new Error("该邮箱尚未注册。");
  }

  const recent = await prisma.emailVerificationCode.findFirst({
    where: {
      email,
      purpose: input.purpose,
      consumedAt: null,
      createdAt: {
        gt: new Date(Date.now() - CODE_RESEND_SECONDS * 1000)
      }
    },
    orderBy: { createdAt: "desc" }
  });
  if (recent) {
    throw new Error(`${CODE_RESEND_SECONDS} 秒内请勿重复获取验证码。`);
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
  await prisma.emailVerificationCode.create({
    data: {
      email,
      purpose: input.purpose,
      codeHash: hashCode(email, input.purpose, code),
      expiresAt,
      ...(existingUser ? { user: { connect: { id: existingUser.id } } } : {})
    }
  });

  const sent = await sendVerificationEmail({
    email,
    code,
    purpose: input.purpose,
    expiresAt
  });

  return {
    email,
    expiresAt: expiresAt.toISOString(),
    devCode: sent.devCode
  };
}

export async function registerEmailUser(input: { email: string; code: string; password: string }) {
  const email = normalizeEmail(input.email);
  validateEmail(email);
  validatePassword(input.password);

  const existingUser = await findEmailUser(email);
  if (existingUser?.passwordHash) {
    throw new Error("该邮箱已注册，请直接登录。");
  }

  await consumeEmailCode({ email, purpose: "register", code: input.code });
  const passwordHash = await hashPassword(input.password);
  const name = email.split("@")[0] || "用户";
  return prisma.user.upsert({
    where: {
      provider_providerUserId: {
        provider: "email",
        providerUserId: email
      }
    },
    create: {
      provider: "email",
      providerUserId: email,
      email,
      name,
      passwordHash,
      emailVerifiedAt: new Date(),
      isActive: true,
      lastLoginAt: new Date()
    },
    update: {
      email,
      name: existingUser?.name ?? name,
      passwordHash,
      emailVerifiedAt: new Date(),
      isActive: true,
      lastLoginAt: new Date()
    }
  });
}

export async function authenticateEmailUser(input: { email: string; password: string }) {
  const email = normalizeEmail(input.email);
  const user = await findEmailUser(email);
  if (!user?.passwordHash || user.provider !== "email") {
    throw new Error("邮箱或密码不正确。");
  }
  if (!user.isActive) {
    throw new Error("该账号已停用。");
  }
  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    throw new Error("邮箱或密码不正确。");
  }
  return prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() }
  });
}

export async function resetEmailPassword(input: { email: string; code: string; password: string }) {
  const email = normalizeEmail(input.email);
  validateEmail(email);
  validatePassword(input.password);

  const user = await findEmailUser(email);
  if (!user?.passwordHash || user.provider !== "email") {
    throw new Error("该邮箱尚未注册。");
  }

  await consumeEmailCode({ email, purpose: "reset_password", code: input.code });
  return prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(input.password),
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      isActive: true
    }
  });
}

async function consumeEmailCode(input: { email: string; purpose: EmailCodePurpose; code: string }) {
  const record = await prisma.emailVerificationCode.findFirst({
    where: {
      email: input.email,
      purpose: input.purpose,
      consumedAt: null,
      expiresAt: { gt: new Date() }
    },
    orderBy: { createdAt: "desc" }
  });
  if (!record) {
    throw new Error("验证码不存在或已过期，请重新获取。");
  }
  if (record.attempts >= 5) {
    await prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() }
    });
    throw new Error("验证码错误次数过多，请重新获取。");
  }

  const expected = hashCode(input.email, input.purpose, input.code.trim());
  if (!safeEqual(record.codeHash, expected)) {
    await prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } }
    });
    throw new Error("验证码不正确。");
  }

  await prisma.emailVerificationCode.update({
    where: { id: record.id },
    data: { consumedAt: new Date() }
  });
}

function findEmailUser(email: string) {
  return prisma.user.findUnique({
    where: {
      provider_providerUserId: {
        provider: "email",
        providerUserId: email
      }
    }
  });
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

async function verifyPassword(password: string, storedHash: string) {
  const [scheme, salt, hash] = storedHash.split("$");
  if (scheme !== "scrypt" || !salt || !hash) {
    return false;
  }
  const derived = await scrypt(password, salt, 64) as Buffer;
  return safeEqual(derived.toString("base64url"), hash);
}

function hashCode(email: string, purpose: EmailCodePurpose, code: string) {
  return createHmac("sha256", emailSecret())
    .update(`${email}:${purpose}:${code}`)
    .digest("base64url");
}

function emailSecret() {
  return process.env.EMAIL_CODE_SECRET || process.env.AUTH_SESSION_SECRET || process.env.DINGTALK_CLIENT_SECRET || "meeting-ai-kit-email-dev-secret";
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function validateEmail(email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("请输入有效的邮箱地址。");
  }
}

function validatePassword(password: string) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`密码至少需要 ${PASSWORD_MIN_LENGTH} 位。`);
  }
}

async function sendVerificationEmail(input: { email: string; code: string; purpose: EmailCodePurpose; expiresAt: Date }) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  const devReturn = process.env.EMAIL_CODE_DEV_RETURN !== "false";

  if (!host || !user || !pass || !from) {
    console.info(`[email-code] ${input.purpose} ${maskEmail(input.email)} ${input.code}`);
    return { devCode: devReturn ? input.code : undefined };
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: process.env.SMTP_SECURE !== "false",
    auth: { user, pass }
  });
  await transporter.sendMail({
    from,
    to: input.email,
    subject: input.purpose === "register" ? "智能妙记注册验证码" : "智能妙记重置密码验证码",
    text: `验证码：${input.code}\n有效期至：${input.expiresAt.toLocaleString("zh-CN", { hour12: false })}\n如非本人操作，请忽略本邮件。`
  });
  return { devCode: undefined };
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function maskEmail(email: string) {
  const digest = createHash("sha256").update(email).digest("hex").slice(0, 8);
  return `hash:${digest}`;
}
