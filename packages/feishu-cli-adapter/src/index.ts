import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type FeishuCliConfig = {
  enabled: boolean;
  bin: string;
  profile: string;
  defaultFolder?: string;
};

export type FeishuCliCommandSummary = {
  command: FeishuCliCommandName;
  args: Record<string, string | number | boolean | undefined>;
};

export type FeishuCliCommandName =
  | "checkAuthStatus"
  | "createDoc"
  | "uploadImage"
  | "appendHeading"
  | "appendParagraph"
  | "appendImage"
  | "appendTable";

export class FeishuCliAdapterError extends Error {
  constructor(
    message: string,
    readonly command: FeishuCliCommandName,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "FeishuCliAdapterError";
  }
}

export interface FeishuCliAdapter {
  checkAuthStatus(): Promise<boolean>;
  createDoc(params: { title: string; folder?: string }): Promise<{ docUrl: string; docToken: string }>;
  uploadImage(params: { imagePath: string }): Promise<{ imageToken: string }>;
  appendHeading(params: { docToken: string; text: string; level: 1 | 2 | 3 }): Promise<void>;
  appendParagraph(params: { docToken: string; text: string }): Promise<void>;
  appendImage(params: { docToken: string; imageToken: string }): Promise<void>;
  appendTable(params: { docToken: string; columns: string[]; rows: string[][] }): Promise<void>;
}

export const FEISHU_CLI_ALLOWED_COMMANDS: readonly FeishuCliCommandName[] = [
  "checkAuthStatus",
  "createDoc",
  "uploadImage",
  "appendHeading",
  "appendParagraph",
  "appendImage",
  "appendTable"
];

export class ShellFeishuCliAdapter implements FeishuCliAdapter {
  constructor(private readonly config: FeishuCliConfig) {}

  async checkAuthStatus(): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    try {
      await this.run("checkAuthStatus", ["auth", "status", "--profile", this.config.profile, "--json"]);
      return true;
    } catch {
      return false;
    }
  }

  async createDoc(params: { title: string; folder?: string }): Promise<{ docUrl: string; docToken: string }> {
    const output = await this.run("createDoc", [
      "docs",
      "create",
      "--title",
      params.title,
      "--profile",
      this.config.profile,
      "--json",
      ...(params.folder || this.config.defaultFolder ? ["--folder", params.folder ?? this.config.defaultFolder ?? ""] : [])
    ]);
    const payload = parseCliJson(output);
    return {
      docUrl: readString(payload, ["docUrl", "doc_url", "url"]),
      docToken: readString(payload, ["docToken", "doc_token", "token"])
    };
  }

  async uploadImage(params: { imagePath: string }): Promise<{ imageToken: string }> {
    const output = await this.run("uploadImage", [
      "drive",
      "upload",
      "--file",
      params.imagePath,
      "--profile",
      this.config.profile,
      "--json"
    ]);
    const payload = parseCliJson(output);
    return {
      imageToken: readString(payload, ["imageToken", "image_token", "fileToken", "file_token", "token"])
    };
  }

  async appendHeading(params: { docToken: string; text: string; level: 1 | 2 | 3 }): Promise<void> {
    await this.run("appendHeading", [
      "docs",
      "append-heading",
      "--doc-token",
      params.docToken,
      "--text",
      params.text,
      "--level",
      String(params.level),
      "--profile",
      this.config.profile
    ]);
  }

  async appendParagraph(params: { docToken: string; text: string }): Promise<void> {
    await this.run("appendParagraph", [
      "docs",
      "append-paragraph",
      "--doc-token",
      params.docToken,
      "--text",
      params.text,
      "--profile",
      this.config.profile
    ]);
  }

  async appendImage(params: { docToken: string; imageToken: string }): Promise<void> {
    await this.run("appendImage", [
      "docs",
      "append-image",
      "--doc-token",
      params.docToken,
      "--image-token",
      params.imageToken,
      "--profile",
      this.config.profile
    ]);
  }

  async appendTable(params: { docToken: string; columns: string[]; rows: string[][] }): Promise<void> {
    await this.run("appendTable", [
      "docs",
      "append-table",
      "--doc-token",
      params.docToken,
      "--columns",
      JSON.stringify(params.columns),
      "--rows",
      JSON.stringify(params.rows),
      "--profile",
      this.config.profile
    ]);
  }

  private async run(command: FeishuCliCommandName, args: string[]) {
    if (!this.config.enabled) {
      throw new FeishuCliAdapterError("Feishu CLI is disabled by configuration.", command);
    }

    if (!FEISHU_CLI_ALLOWED_COMMANDS.includes(command)) {
      throw new FeishuCliAdapterError(`Command ${command} is not whitelisted.`, command);
    }

    try {
      const result = await execFileAsync(this.config.bin, args, {
        timeout: 60000,
        maxBuffer: 1024 * 1024
      });
      return result.stdout.trim();
    } catch (error) {
      throw new FeishuCliAdapterError(
        `Feishu CLI command failed: ${this.config.bin} ${args.map(maskSensitiveArg).join(" ")}`,
        command,
        error
      );
    }
  }
}

export class FakeFeishuCliAdapter implements FeishuCliAdapter {
  async checkAuthStatus(): Promise<boolean> {
    return true;
  }

  async createDoc(params: { title: string; folder?: string }): Promise<{ docUrl: string; docToken: string }> {
    const token = `fake_doc_${slug(params.title)}`;
    return {
      docToken: token,
      docUrl: `https://fake.feishu.local/docx/${token}${params.folder ? `?folder=${encodeURIComponent(params.folder)}` : ""}`
    };
  }

  async uploadImage(params: { imagePath: string }): Promise<{ imageToken: string }> {
    return {
      imageToken: `fake_image_${slug(params.imagePath)}`
    };
  }

  async appendHeading(): Promise<void> {
    return;
  }

  async appendParagraph(): Promise<void> {
    return;
  }

  async appendImage(): Promise<void> {
    return;
  }

  async appendTable(): Promise<void> {
    return;
  }
}

function parseCliJson(output: string) {
  try {
    return JSON.parse(output) as Record<string, unknown>;
  } catch (error) {
    throw new FeishuCliAdapterError("Feishu CLI did not return valid JSON.", "createDoc", error);
  }
}

function readString(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  throw new Error(`Feishu CLI JSON is missing one of: ${keys.join(", ")}`);
}

function maskSensitiveArg(value: string) {
  return value.length > 80 ? `${value.slice(0, 40)}...` : value;
}

function slug(value: string) {
  return Buffer.from(value).toString("base64url").slice(0, 24) || "empty";
}
