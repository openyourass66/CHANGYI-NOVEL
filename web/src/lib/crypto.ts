import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * 模型密钥的本机加密（AES-256-GCM）。
 * 密文仅存于服务端数据库；绝不出现在客户端包、项目导出或日志中。
 */

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

function loadKey(): Buffer {
  const hex = process.env.APP_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "缺少 APP_ENCRYPTION_KEY：请在 .env 中配置 64 位十六进制主密钥后再保存密钥。",
    );
  }
  const key = Buffer.from(hex.trim(), "hex");
  if (key.length !== 32) {
    throw new Error(
      `APP_ENCRYPTION_KEY 长度错误：需 32 字节（64 位十六进制），当前 ${key.length} 字节。`,
    );
  }
  return key;
}

export function isEncryptionConfigured(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

type EncryptedPayload = { v: 1; iv: string; tag: string; ct: string };

/** 返回可存库的 JSON 字符串。 */
export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const payload: EncryptedPayload = {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ct: ct.toString("base64"),
  };
  return JSON.stringify(payload);
}

export function decryptSecret(stored: string): string {
  const payload = JSON.parse(stored) as EncryptedPayload;
  if (payload.v !== 1) {
    throw new Error(`不支持的密钥密文版本：${payload.v}`);
  }
  const key = loadKey();
  const decipher = createDecipheriv(
    ALGO,
    key,
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ct, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** 仅用于界面回显，不泄露完整密钥。 */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 4) return "••••";
  return `••••••${plaintext.slice(-4)}`;
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
