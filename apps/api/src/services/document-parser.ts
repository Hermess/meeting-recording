import { promisify } from "node:util";
import { parseOffice } from "officeparser";
import textract from "textract";

const textractFromBufferWithMime = promisify<string, Buffer, string>(textract.fromBufferWithMime.bind(textract));

const MIME_BY_EXTENSION: Record<string, string> = {
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
  ".md": "text/markdown"
};

export async function extractTranscriptFromUpload(input: {
  filename: string;
  mimeType?: string;
  buffer: Buffer;
}) {
  const extension = input.filename.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  if (extension === ".md") {
    return input.buffer.toString("utf8");
  }

  if (![".doc", ".docx", ".pdf"].includes(extension)) {
    throw new Error("暂只支持 md、doc、docx、pdf 文件。");
  }

  if (extension === ".doc") {
    const mime = input.mimeType || MIME_BY_EXTENSION[extension] || "application/msword";
    const text = await textractFromBufferWithMime(mime, input.buffer).catch((error) => {
      throw new Error(`DOC 文件解析失败：${error instanceof Error ? error.message : String(error)}`);
    });
    return normalizeText(text);
  }

  const ast = await parseOffice(input.buffer, {
    includeRawContent: false,
    extractAttachments: false,
    ocr: false
  }).catch((error) => {
    throw new Error(`文件解析失败：${error instanceof Error ? error.message : String(error)}`);
  });

  return normalizeText(ast.toText());
}

function normalizeText(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
