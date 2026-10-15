import "server-only";
import nodemailer from "nodemailer";

export async function sendAccountMail(email: string, subject: string, text: string) {
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || SMTP_PASSWORD.startsWith("replace-") || !SMTP_FROM) {
    throw new Error("邮件服务尚未配置，请联系服务维护者。");
  }
  const secure = process.env.SMTP_SECURE !== "false";
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 465),
    secure,
    requireTLS: !secure,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    connectionTimeout: 10_000,
    socketTimeout: 20_000,
    logger: false,
    debug: false,
  });
  try {
    await transport.sendMail({ from: SMTP_FROM, to: email, subject, text });
  } catch {
    // Nodemailer 原始错误可能带服务器地址、邮箱或 SMTP 交互信息。
    throw new Error("邮件发送失败，请稍后重试或联系服务维护者。");
  } finally {
    transport.close();
  }
}
