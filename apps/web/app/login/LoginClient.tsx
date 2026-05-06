"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../../lib/api";

type AuthMe = {
  authenticated: boolean;
  authEnabled: boolean;
  user?: {
    id: string;
    name: string;
    email?: string | null;
  } | null;
};

type AuthMode = "login" | "register" | "reset";

type EmailCodeResponse = {
  email: string;
  expiresAt: string;
  devCode?: string;
};

export function LoginClient({ redirect, error }: { redirect?: string; error?: string }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState(error ?? "");
  const [devCode, setDevCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthMe | null>(null);
  const redirectPath = useMemo(() => sanitizeRedirectPath(redirect ?? "/dashboard"), [redirect]);

  useEffect(() => {
    let cancelled = false;
    void apiGet<AuthMe>("/api/auth/me").then((result) => {
      if (cancelled) return;
      if (result.data) {
        setAuthStatus(result.data);
        if (result.data.authenticated) {
          window.location.href = redirectPath;
        }
      } else if (result.error) {
        setMessage(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [redirectPath]);

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setMessage("");
    setDevCode("");
    setCode("");
    setPassword("");
    setConfirmPassword("");
  }

  async function sendCode() {
    if (!email.trim()) {
      setMessage("请先输入邮箱。");
      return;
    }
    setIsLoading(true);
    setMessage("");
    setDevCode("");
    const result = await apiPost<EmailCodeResponse>("/api/auth/email-code", {
      email,
      purpose: mode === "reset" ? "reset_password" : "register"
    });
    setIsLoading(false);
    if (result.error || !result.data) {
      setMessage(result.error ?? "验证码发送失败。");
      return;
    }
    setDevCode(result.data.devCode ?? "");
    setMessage(result.data.devCode ? "本地开发验证码已生成，可直接复制使用。" : "验证码已发送，请查收邮箱。");
  }

  async function submit() {
    setMessage("");
    setDevCode("");
    if (mode === "login") {
      await login();
      return;
    }
    if (password !== confirmPassword) {
      setMessage("两次输入的密码不一致。");
      return;
    }
    if (mode === "register") {
      await register();
      return;
    }
    await resetPassword();
  }

  async function login() {
    setIsLoading(true);
    const result = await apiPost<{ user: AuthMe["user"] }>("/api/auth/login", { email, password });
    setIsLoading(false);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    window.location.href = redirectPath;
  }

  async function register() {
    setIsLoading(true);
    const result = await apiPost<{ user: AuthMe["user"] }>("/api/auth/register", { email, code, password });
    setIsLoading(false);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    window.location.href = redirectPath;
  }

  async function resetPassword() {
    setIsLoading(true);
    const result = await apiPost<{ ok: boolean }>("/api/auth/reset-password", { email, code, password });
    setIsLoading(false);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setMode("login");
    setCode("");
    setPassword("");
    setConfirmPassword("");
    setMessage("密码已重置，请使用新密码登录。");
  }

  if (authStatus?.authEnabled === false) {
    return (
      <div className="login-split">
        <section className="login-left">
          <div className="login-brand-line">
            <span className="login-brand-mark">M</span>
            <span>
              <span className="login-brand-name">智能妙记</span>
              <span className="login-brand-desc">AI 会议纪要视觉报告生成器</span>
            </span>
          </div>
          <div className="scan-login-card">
            <h1>本地模式</h1>
            <p className="scan-desc">当前未启用登录，可直接进入业务页面。</p>
            <a className="login-primary-link" href={redirectPath}>进入系统</a>
          </div>
        </section>
        <LoginHero />
      </div>
    );
  }

  return (
    <div className="login-split">
      <section className="login-left">
        <div className="login-brand-line">
          <span className="login-brand-mark">M</span>
          <span>
            <span className="login-brand-name">智能妙记</span>
            <span className="login-brand-desc">AI 会议纪要视觉报告生成器</span>
          </span>
        </div>

        <div className="scan-login-card login-password-card">
          <h1>{modeTitle(mode)}</h1>
          <p className="scan-desc">{modeDescription(mode)}</p>

          {message ? <div className={message.includes("失败") || message.includes("不") || message.includes("错误") ? "login-error" : "login-alert"}>{message}</div> : null}
          {devCode ? (
            <div className="login-dev-code">
              <span>本地验证码</span>
              <strong>{devCode}</strong>
            </div>
          ) : null}

          <div className="login-form">
            <label>
              <span>邮箱</span>
              <input autoComplete="email" inputMode="email" placeholder="name@example.com" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>

            {mode !== "login" ? (
              <label>
                <span>验证码</span>
                <div className="login-code-row">
                  <input autoComplete="one-time-code" inputMode="numeric" maxLength={6} placeholder="6 位验证码" value={code} onChange={(event) => setCode(event.target.value)} />
                  <button disabled={isLoading} onClick={() => void sendCode()} type="button">
                    获取验证码
                  </button>
                </div>
              </label>
            ) : null}

            <label>
              <span>{mode === "reset" ? "新密码" : "密码"}</span>
              <input autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="至少 8 位" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>

            {mode !== "login" ? (
              <label>
                <span>确认密码</span>
                <input autoComplete="new-password" placeholder="再次输入密码" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
              </label>
            ) : null}
          </div>

          <button className="login-primary-button" disabled={isLoading} onClick={() => void submit()} type="button">
            {isLoading ? "处理中..." : primaryButtonText(mode)}
          </button>

          <div className="login-mode-actions">
            {mode !== "login" ? (
              <button type="button" onClick={() => switchMode("login")}>返回登录</button>
            ) : (
              <>
                <button type="button" onClick={() => switchMode("register")}>注册账号</button>
                <button type="button" onClick={() => switchMode("reset")}>忘记密码</button>
              </>
            )}
          </div>
        </div>
      </section>

      <LoginHero />
    </div>
  );
}

function LoginHero() {
  return (
    <section className="login-hero" aria-label="产品介绍">
      <div className="login-hero-art" aria-hidden="true">
        <div className="hero-cloud hero-cloud-a" />
        <div className="hero-cloud hero-cloud-b" />
        <div className="hero-house" />
        <div className="hero-tower" />
        <div className="hero-card" />
        <div className="hero-card hero-card-small" />
        <div className="hero-play" />
        <div className="hero-person" />
        <div className="hero-dot hero-dot-blue" />
        <div className="hero-dot hero-dot-yellow" />
      </div>
      <div className="login-hero-copy">
        <h2>先记录会议，再沉淀知识</h2>
        <p>登录后，录音、转写、纪要、长图和语雀发布记录都会按个人账号隔离。</p>
      </div>
    </section>
  );
}

function modeTitle(mode: AuthMode) {
  if (mode === "register") return "注册账号";
  if (mode === "reset") return "重置密码";
  return "账号登录";
}

function modeDescription(mode: AuthMode) {
  if (mode === "register") return "使用邮箱验证码创建你的智能妙记账号";
  if (mode === "reset") return "通过邮箱验证码验证身份后设置新密码";
  return "使用邮箱和密码进入你的会议工作台";
}

function primaryButtonText(mode: AuthMode) {
  if (mode === "register") return "注册并登录";
  if (mode === "reset") return "重置密码";
  return "登录";
}

function sanitizeRedirectPath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
}
