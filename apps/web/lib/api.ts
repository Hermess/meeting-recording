const DEFAULT_API_BASE_URL = "http://localhost:4000";

export const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL;

export type ApiResult<T> = {
  data?: T;
  error?: string;
  [key: string]: unknown;
};

export async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      cache: "no-store",
      credentials: "include"
    });

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

export async function apiPost<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });

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

export async function apiPatch<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });

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

export async function apiDelete<T>(path: string): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: "DELETE",
      credentials: "include"
    });

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
