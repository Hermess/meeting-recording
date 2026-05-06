"use client";

import { useEffect } from "react";

export function DingTalkCallbackClient({ code, state }: { code: string; state: string }) {
  useEffect(() => {
    if (window.parent && code && state) {
      window.parent.postMessage({
        type: "dingtalk-oauth-code",
        code,
        state
      }, window.location.origin);
    }
  }, [code, state]);

  return (
    <main className="login-callback-page">
      <div className="login-callback-card">
        <h1>{code && state ? "登录成功" : "登录参数缺失"}</h1>
        <p>{code && state ? "正在返回智能妙记..." : "请刷新二维码后重新扫码。"}</p>
      </div>
    </main>
  );
}
