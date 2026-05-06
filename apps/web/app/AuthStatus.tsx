"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../lib/api";

type AuthMe = {
  authenticated: boolean;
  authEnabled: boolean;
  user?: {
    id: string;
    name: string;
    email?: string | null;
    avatarUrl?: string | null;
  } | null;
};

export function AuthStatus() {
  const [auth, setAuth] = useState<AuthMe | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiGet<AuthMe>("/api/auth/me").then((result) => {
      if (!cancelled && result.data) {
        setAuth(result.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await apiPost("/api/auth/logout", {});
    window.location.href = "/login";
  }

  if (!auth?.authEnabled) {
    return null;
  }

  if (!auth.authenticated) {
    return (
      <a className="topbar-auth-link" href="/login">
        登录
      </a>
    );
  }

  return (
    <div className="topbar-user">
      <span className="topbar-user-avatar">{auth.user?.name?.slice(0, 1) || auth.user?.email?.slice(0, 1) || "用"}</span>
      <span className="topbar-user-name">{auth.user?.name || auth.user?.email || "用户"}</span>
      <button className="topbar-user-logout" type="button" onClick={logout}>
        退出
      </button>
    </div>
  );
}
