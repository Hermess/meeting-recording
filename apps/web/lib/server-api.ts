import { headers } from "next/headers";
import { apiBaseUrl, type ApiResult } from "./api";

export async function serverApiGet<T>(path: string, options?: { internalToken?: string }): Promise<ApiResult<T>> {
  try {
    const headerStore = await headers();
    const cookie = headerStore.get("cookie");
    const requestHeaders: Record<string, string> = {};
    if (cookie) {
      requestHeaders.cookie = cookie;
    }
    if (options?.internalToken) {
      requestHeaders["x-meeting-ai-internal-token"] = options.internalToken;
    }
    const init: RequestInit = { cache: "no-store" };
    if (Object.keys(requestHeaders).length > 0) {
      init.headers = requestHeaders;
    }
    const response = await fetch(`${apiBaseUrl}${path}`, init);
    const payload = (await response.json().catch(() => ({}))) as ApiResult<T> & { message?: string };

    if (!response.ok) {
      return { error: payload.message || payload.error || `${response.status} ${response.statusText}` };
    }

    return payload.data === undefined ? { ...payload, data: payload as T } : payload;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown API error"
    };
  }
}
