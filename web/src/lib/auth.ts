import "server-only";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP } from "better-auth/plugins";
import { prisma } from "@/lib/db";
import { sendAccountMail } from "@/lib/mail";
import { authRedisStorage } from "@/lib/auth-redis";
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "@/lib/password-policy";

export function createAuth(deliver: typeof sendAccountMail = sendAccountMail, secondaryStorage = authRedisStorage) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith("replace-")) {
    throw new Error("请配置至少 32 字符的 BETTER_AUTH_SECRET。");
  }
  const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  return betterAuth({
    appName: "长忆",
    secret,
    baseURL,
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // 禁用使用邮件链接重置密码的旧端点；密码找回必须通过邮箱验证码。
        if (ctx.path === "/request-password-reset" || ctx.path === "/reset-password" || ctx.path.startsWith("/reset-password/")) {
          throw new APIError("BAD_REQUEST", { code: "EMAIL_OTP_REQUIRED", message: "邮件链接重置密码已停用，请使用邮箱验证码重置密码。" });
        }
        const password = ctx.path === "/sign-up/email" ? ctx.body?.password
          : ["/reset-password", "/change-password", "/set-password"].includes(ctx.path) ? ctx.body?.newPassword : undefined;
        if (typeof password === "string" && password.length > MAX_PASSWORD_LENGTH) {
          throw new APIError("BAD_REQUEST", { code: "PASSWORD_TOO_LONG", message: `密码最多 ${MAX_PASSWORD_LENGTH} 个字符。` });
        }
      }),
    },
    database: prismaAdapter(prisma, {
      provider: process.env.DATABASE_PROVIDER === "postgresql" ? "postgresql" : "sqlite",
      transaction: true,
    }),
    secondaryStorage,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      // 认证库也用此上限校验登录密码，保留旧账号兼容；新密码由上方 hook 限定为 20。
      maxPasswordLength: 128,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      expiresIn: 300,
    },
    verification: { storeIdentifier: "hashed", storeInDatabase: false },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      storeSessionInDatabase: true,
      cookieCache: { enabled: false },
    },
    advanced: {
      useSecureCookies: new URL(baseURL).protocol === "https:",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
      // 本机自测统一限流桶；路由覆写该请求头，避免客户端伪造来源绕过限流。
      ipAddress: { ipAddressHeaders: ["x-changyi-auth-ip"] },
    },
    rateLimit: {
      enabled: true,
      storage: "secondary-storage",
      window: 60,
      max: 120,
      customRules: {
        "/sign-up/email": { window: 60, max: 3 },
        "/sign-in/email": { window: 60, max: 5 },
        "/email-otp/send-verification-otp": { window: 60, max: 3 },
        "/email-otp/verify-email": { window: 60, max: 5 },
        "/email-otp/request-password-reset": { window: 60, max: 2 },
        "/email-otp/reset-password": { window: 60, max: 5 },
      },
    },
    plugins: [emailOTP({
      sendVerificationOnSignUp: true,
      overrideDefaultEmailVerification: true,
      // 验证码仅用于已有账号登录；新账号仍需通过显式注册流程创建。
      disableSignUp: true,
      expiresIn: 300,
      allowedAttempts: 5,
      storeOTP: "hashed",
      rateLimit: { window: 60, max: 3 },
      async sendVerificationOTP({ email, otp, type }) {
        const purpose = type === "email-verification" ? "验证邮箱" : type === "forget-password" ? "找回密码" : type === "sign-in" ? "登录" : "修改邮箱";
        await deliver(email, `长忆${purpose}验证码`, `你的验证码是：${otp}\n\n验证码 5 分钟内有效，请勿告诉他人。如果不是你发起的请求，请忽略此邮件。`);
      },
    })],
    // 禁止认证库输出包含数据库查询、令牌或邮件地址的诊断信息。
    logger: { disabled: true },
  });
}

let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  return (instance ??= createAuth());
}
