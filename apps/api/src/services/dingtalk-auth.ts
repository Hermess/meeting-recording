import { createSignedState, verifySignedState } from "./auth.js";

export type DingTalkProfile = {
  providerUserId: string;
  unionId?: string;
  openId?: string;
  name: string;
  avatarUrl?: string;
  email?: string;
  mobile?: string;
};

export function getDingTalkConfig() {
  const clientId = process.env.DINGTALK_CLIENT_ID ?? "";
  const clientSecret = process.env.DINGTALK_CLIENT_SECRET ?? "";
  const redirectUri = process.env.DINGTALK_REDIRECT_URI ?? `http://localhost:${process.env.API_PORT ?? 4000}/api/auth/dingtalk/callback`;
  const webBaseUrl = process.env.WEB_BASE_URL ?? `http://localhost:${process.env.WEB_PORT ?? 3000}`;
  const webRedirectUri = process.env.DINGTALK_WEB_REDIRECT_URI ?? `${webBaseUrl}/login/dingtalk-callback`;
  return {
    clientId,
    clientSecret,
    redirectUri,
    webRedirectUri,
    webBaseUrl,
    configured: Boolean(clientId && clientSecret)
  };
}

export function buildDingTalkLoginUrl(redirectPath: string) {
  const config = getDingTalkConfig();
  if (!config.configured) {
    throw new Error("钉钉扫码登录未配置。请先设置 DINGTALK_CLIENT_ID 和 DINGTALK_CLIENT_SECRET。");
  }

  const url = new URL("https://login.dingtalk.com/oauth2/auth");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", "openid");
  url.searchParams.set("state", createSignedState({ redirectPath }));
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

export function buildDingTalkWidgetConfig(redirectPath: string) {
  const config = getDingTalkConfig();
  if (!config.configured) {
    throw new Error("钉钉扫码登录未配置。请先设置 DINGTALK_CLIENT_ID 和 DINGTALK_CLIENT_SECRET。");
  }

  return {
    scriptUrl: "https://g.alicdn.com/dingding/h5-dingtalk-login/0.21.0/ddlogin.js",
    frame: {
      id: "dingtalk-frame-login",
      width: 300,
      height: 300
    },
    login: {
      redirect_uri: encodeURIComponent(config.webRedirectUri),
      client_id: config.clientId,
      scope: "openid",
      response_type: "code",
      state: createSignedState({ redirectPath, embedded: true }),
      prompt: "consent"
    }
  };
}

export function verifyDingTalkState(state: string) {
  return verifySignedState(state);
}

export async function getDingTalkProfile(code: string): Promise<DingTalkProfile> {
  const config = getDingTalkConfig();
  if (!config.configured) {
    throw new Error("钉钉扫码登录未配置。");
  }
  if (!code.trim()) {
    throw new Error("钉钉回调缺少授权码。");
  }

  const tokenResponse = await fetch("https://api.dingtalk.com/v1.0/oauth2/userAccessToken", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      grantType: "authorization_code"
    })
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({})) as { accessToken?: string; message?: string; code?: string };
  if (!tokenResponse.ok || !tokenPayload.accessToken) {
    throw new Error(tokenPayload.message || tokenPayload.code || `钉钉 accessToken 获取失败：${tokenResponse.status}`);
  }

  const profileResponse = await fetch("https://api.dingtalk.com/v1.0/contact/users/me", {
    headers: {
      "x-acs-dingtalk-access-token": tokenPayload.accessToken
    }
  });
  const profile = await profileResponse.json().catch(() => ({})) as Record<string, unknown>;
  if (!profileResponse.ok) {
    throw new Error(String(profile.message || profile.code || `钉钉用户信息获取失败：${profileResponse.status}`));
  }

  const unionId = stringValue(profile.unionId);
  const openId = stringValue(profile.openId);
  const avatarUrl = stringValue(profile.avatarUrl);
  const email = stringValue(profile.email);
  const mobile = stringValue(profile.mobile);
  const userId = stringValue(profile.userid) || unionId || openId;
  if (!userId) {
    throw new Error("钉钉用户信息缺少 unionId/openId/userid。");
  }

  return {
    providerUserId: userId,
    name: stringValue(profile.nick) || stringValue(profile.name) || "钉钉用户",
    ...(unionId ? { unionId } : {}),
    ...(openId ? { openId } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(email ? { email } : {}),
    ...(mobile ? { mobile } : {})
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
