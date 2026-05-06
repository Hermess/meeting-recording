import { readFile } from "node:fs/promises";

export type YuqueConfig = {
  enabled: boolean;
  apiBaseUrl: string;
  token: string;
};

export type YuqueRepo = {
  id: number;
  name: string;
  slug: string;
  namespace: string;
  description?: string | undefined;
};

export type YuqueUser = {
  id: number;
  login: string;
  name: string;
};

export type YuqueDoc = {
  id: number;
  title: string;
  slug: string;
  url: string;
};

export type YuqueTocNode = {
  title: string;
  type: "TITLE" | "DOC" | string;
  url?: string;
  uuid?: string;
  id?: number | string;
  doc_id?: number | string;
  depth?: number;
  visible?: number;
};

export class YuqueAdapterError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "YuqueAdapterError";
  }
}

export class YuqueAdapter {
  constructor(private readonly config: YuqueConfig) {}

  async testConnection(): Promise<YuqueUser> {
    const payload = await this.request<{ data: YuqueUser }>("/user");
    return payload.data;
  }

  async listRepos(login?: string): Promise<YuqueRepo[]> {
    const user = login ? { login } : await this.testConnection();
    const payload = await this.request<{ data: YuqueRepo[] }>(`/users/${encodeURIComponent(user.login)}/repos`);
    return payload.data.map((repo) => ({
      id: repo.id,
      name: repo.name,
      slug: repo.slug,
      namespace: repo.namespace ?? `${user.login}/${repo.slug}`,
      description: repo.description
    }));
  }

  async createDoc(input: {
    namespace: string;
    title: string;
    slug: string;
    body: string;
    publicLevel: number;
  }): Promise<YuqueDoc> {
    const payload = await this.request<{ data: { id: number; title: string; slug: string; url?: string } }>(
      `/repos/${input.namespace}/docs`,
      {
        method: "POST",
        body: {
          title: input.title,
          slug: input.slug,
          body: input.body,
          format: "markdown",
          public: input.publicLevel
        }
      }
    );
    return {
      id: payload.data.id,
      title: payload.data.title,
      slug: payload.data.slug,
      url: payload.data.url ?? `https://www.yuque.com/${input.namespace}/${payload.data.slug}`
    };
  }

  async getToc(namespace: string): Promise<YuqueTocNode[]> {
    const payload = await this.request<{ data: YuqueTocNode[] }>(`/repos/${namespace}/toc`);
    return Array.isArray(payload.data) ? payload.data : [];
  }

  async ensureDocInToc(input: {
    namespace: string;
    doc: YuqueDoc;
  }): Promise<{ inserted: boolean; tocCount: number }> {
    const toc = await this.getToc(input.namespace);
    const alreadyVisible = toc.some((node) => {
      const nodeDocId = node.doc_id ?? node.id;
      return String(node.url ?? "") === input.doc.slug || String(nodeDocId ?? "") === String(input.doc.id);
    });

    if (alreadyVisible) {
      return { inserted: false, tocCount: toc.length };
    }

    // Yuque creates the document content first; a separate TOC update is needed
    // for the document to appear in the knowledge base sidebar/list.
    const payload = await this.request<{ data: YuqueTocNode[] }>(`/repos/${input.namespace}/toc`, {
      method: "PUT",
      body: {
        action: "appendNode",
        action_mode: "child",
        type: "DOC",
        doc_ids: [input.doc.id],
        visible: "1"
      }
    });

    return {
      inserted: true,
      tocCount: Array.isArray(payload.data) ? payload.data.length : toc.length + 1
    };
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    if (!this.config.enabled) {
      throw new YuqueAdapterError("语雀发布未启用。请先在设置页测试并保存语雀 Token。");
    }
    if (!this.config.token) {
      throw new YuqueAdapterError("语雀 Token 未配置。");
    }

    const response = await fetch(`${this.config.apiBaseUrl}${path}`, {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "X-Auth-Token": this.config.token
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {})
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) as { message?: string } : {};
    if (!response.ok) {
      throw new YuqueAdapterError(payload.message || `语雀接口返回 ${response.status}`, response.status);
    }
    return payload as T;
  }
}

export async function imageToMarkdownDataUri(imagePath?: string | null) {
  if (!imagePath) {
    return "";
  }
  const bytes = await readFile(imagePath).catch(() => null);
  if (!bytes) {
    return "";
  }
  return `![会议总结长图](data:image/png;base64,${bytes.toString("base64")})`;
}
