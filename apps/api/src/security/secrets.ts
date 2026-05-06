import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const PREFIX = "enc:v1:";

function getKey() {
  const secret = process.env.CONFIG_ENCRYPTION_KEY ?? "meeting-ai-kit-local-development-key";
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(value: string) {
  if (!value) {
    return "";
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${Buffer.concat([iv, tag, encrypted]).toString("base64")}`;
}

export function decryptSecret(value: string) {
  if (!value) {
    return "";
  }

  if (!value.startsWith(PREFIX)) {
    return value;
  }

  const payload = Buffer.from(value.slice(PREFIX.length), "base64");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
