"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type MouseEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "@/lib/password-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export type AccountMode = "login" | "register" | "forgot";
const titles: Record<AccountMode, string> = { login: "登录", register: "创建账号", forgot: "找回密码" };
const errorMessages: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "邮箱或密码不正确。",
  EMAIL_NOT_VERIFIED: "该邮箱尚未验证，请切换到邮箱验证码登录并完成验证。",
  PASSWORD_TOO_SHORT: `密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符。`,
  PASSWORD_TOO_LONG: `密码最多 ${MAX_PASSWORD_LENGTH} 个字符。`,
  INVALID_OTP: "验证码不正确或已过期，请检查后重试。",
  OTP_EXPIRED: "验证码已过期，请重新发送。",
  TOO_MANY_REQUESTS: "操作过于频繁，请一分钟后重试。",
};

export function AccountForm({ mode }: { mode: AccountMode }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const [loginMethod, setLoginMethod] = useState<"password" | "otp">("password");
  const [otpSent, setOtpSent] = useState(false);
  const [pendingEmail, setPendingEmail] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const needsPassword = (mode === "login" && loginMethod === "password") || mode === "register" || mode === "forgot";
  const needsOtp = mode === "register" || mode === "forgot" || (mode === "login" && loginMethod === "otp");
  const otpPurpose = mode === "forgot" ? "forget-password" : "email-verification";

  function showError(result: { error?: { status?: number; code?: string } | null } | undefined, fallback: string) {
    if (!result) setError(fallback);
    else if (result.error) setError(result.error.status === 429 ? errorMessages.TOO_MANY_REQUESTS : errorMessages[result.error.code ?? ""] ?? fallback);
    return !result || Boolean(result.error);
  }

  async function sendOtp(event: MouseEvent<HTMLButtonElement>) {
    if (busy) return;
    const form = new FormData(event.currentTarget.form ?? undefined);
    const email = String(form.get("email") ?? pendingEmail).trim().toLowerCase();
    const name = String(form.get("name") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    if (!email) { setError("请先填写邮箱。"); return; }
    if (mode === "register") {
      if (!name) { setError("请先填写昵称。"); return; }
      if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
        setError(`密码长度需为 ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} 个字符。`); return;
      }
      if (password !== confirmPassword) { setError("两次输入的密码不一致。"); return; }
    }
    setError(""); setMessage(""); setBusy(true);
    try {
      let result;
      if (mode === "register" && !otpSent) {
        // Better Auth 创建未验证账号并在同一个注册请求中发出邮箱验证码。
        result = await authClient.signUp.email({ email, password, name });
      } else if (mode === "forgot" && !otpSent) {
        result = await authClient.emailOtp.requestPasswordReset({ email });
      } else if (mode === "login") {
        result = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
      } else {
        result = await authClient.emailOtp.sendVerificationOtp({ email, type: otpPurpose });
      }
      if (showError(result, "发送验证码失败，请稍后重试。")) return;
      setPendingEmail(email);
      setOtpSent(true);
      setMessage(mode === "login"
        ? "如果邮箱已注册，请查收验证码邮件。"
        : mode === "forgot" ? "如果邮箱已注册，请查收找回密码邮件。" : "");
    } catch {
      setError("无法连接服务，请稍后重试。");
    } finally { setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = (otpSent ? pendingEmail : String(form.get("email") ?? "")).trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    const otp = String(form.get("otp") ?? "").trim();
    setError(""); setMessage("");

    if (["register", "forgot"].includes(mode) && !otpSent) {
      setError(mode === "register" ? "请先点击邮箱旁的按钮发送验证码。" : "请先发送邮箱验证码。"); return;
    }
    if (mode === "forgot" && password !== form.get("confirmPassword")) {
      setError("两次输入的新密码不一致。"); return;
    }

    setBusy(true);
    try {
      let result;
      if (mode === "login") {
        result = loginMethod === "password"
          ? await authClient.signIn.email({ email, password })
          : await authClient.signIn.emailOtp({ email, otp });
      } else if (mode === "register") {
        result = await authClient.emailOtp.verifyEmail({ email, otp });
      } else if (mode === "forgot") {
        result = await authClient.emailOtp.resetPassword({ email, otp, password });
      }
      if (showError(result, "操作失败，请检查输入后重试。")) return;
      if (mode === "login") {
        router.replace("/");
        router.refresh();
      } else if (mode === "forgot") {
        setOtpSent(false);
        setPendingEmail("");
        formElement.reset();
        setMessage("密码已更新，旧会话已撤销，请使用新密码登录。");
      } else {
        router.replace("/login");
        router.refresh();
      }
    } catch {
      setError("无法连接服务，请稍后重试。");
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{titles[mode]}</CardTitle>
          <CardDescription>
            {mode === "login" ? "登录后继续你的小说项目。" : mode === "register" ? "验证邮箱后即可开始使用。" : "通过邮箱验证码重设密码。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {mode === "login" && <div className="grid grid-cols-2 gap-2" role="group" aria-label="选择登录方式">
              <Button type="button" variant={loginMethod === "password" ? "default" : "outline"} aria-pressed={loginMethod === "password"} disabled={busy} onClick={() => { setLoginMethod("password"); setOtpSent(false); setPendingEmail(""); setError(""); setMessage(""); }}>
                密码登录
              </Button>
              <Button type="button" variant={loginMethod === "otp" ? "default" : "outline"} aria-pressed={loginMethod === "otp"} disabled={busy} onClick={() => { setLoginMethod("otp"); setOtpSent(false); setPendingEmail(""); setError(""); setMessage(""); }}>
                验证码登录
              </Button>
          </div>}
          <form onSubmit={submit} className="space-y-4" aria-busy={busy}>
            {mode === "register" && <div className="space-y-2"><Label htmlFor="name">昵称</Label><Input id="name" name="name" autoComplete="nickname" maxLength={80} required disabled={busy || otpSent} /></div>}
            {mode !== "login" && mode !== "register" && <div className="space-y-2">
              <Label htmlFor="email">邮箱地址</Label>
              <div className="flex gap-2">
                <Input id="email" name="email" type="email" autoComplete="email" maxLength={254} required disabled={busy || otpSent} defaultValue={otpSent ? pendingEmail : undefined} />
                <Button type="button" variant="outline" className="min-h-11 shrink-0" disabled={busy} onClick={sendOtp}>
                  {busy ? "处理中…" : otpSent ? "重新发送" : "发送验证码"}
                </Button>
              </div>
            </div>}
            {mode === "login" && <div className="space-y-2">
              <Label htmlFor="email">邮箱地址</Label>
              <div className="flex gap-2">
                <Input id="email" name="email" type="email" autoComplete="email" maxLength={254} required disabled={busy || (loginMethod === "otp" && otpSent)} defaultValue={otpSent ? pendingEmail : undefined} />
                {loginMethod === "otp" && <Button type="button" variant="outline" className="min-h-11 shrink-0" disabled={busy} onClick={sendOtp}>
                  {busy ? "发送中…" : otpSent ? "重新发送" : "发送验证码"}
                </Button>}
              </div>
            </div>}
            {needsPassword && <div className="space-y-2"><Label htmlFor="password">{mode === "forgot" ? "新密码" : "密码"}</Label><Input id="password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "login" ? 1 : MIN_PASSWORD_LENGTH} maxLength={mode === "login" ? 128 : MAX_PASSWORD_LENGTH} required disabled={busy} /><p className="text-xs text-muted-foreground">{mode !== "login" && `${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} 个字符，请使用独立密码。`}</p></div>}
            {(mode === "register" || mode === "forgot") && <div className="space-y-2"><Label htmlFor="confirmPassword">确认密码</Label><Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH} required disabled={busy || (mode === "register" && otpSent)} /></div>}
            {mode === "register" && <div className="space-y-2">
              <Label htmlFor="email">邮箱地址</Label>
              <div className="flex gap-2">
                <Input id="email" name="email" type="email" autoComplete="email" maxLength={254} required disabled={busy || otpSent} defaultValue={otpSent ? pendingEmail : undefined} />
                <Button type="button" variant="outline" className="min-h-11 shrink-0" disabled={busy} onClick={sendOtp}>
                  {busy ? "处理中…" : otpSent ? "重新发送" : "发送验证码"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">验证码将发送到该邮箱。</p>
            </div>}
            {needsOtp && <div className="space-y-2"><Label htmlFor="otp">邮箱验证码</Label><Input id="otp" name="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required disabled={busy} aria-describedby="otp-help" /><p id="otp-help" className="text-xs text-muted-foreground">{otpSent ? "请输入邮件中的 6 位验证码，有效期 5 分钟。" : "发送验证码后，在此输入收到的 6 位数字。"}</p></div>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {message && <p role="status" className="text-sm text-foreground">{message}</p>}
            <Button type="submit" className="w-full" disabled={busy || ((mode === "register" || mode === "forgot" || (mode === "login" && loginMethod === "otp")) && !otpSent)}>
              {busy ? "正在处理…" : mode === "login" ? "登录" : mode === "register" ? "验证并完成" : "重置密码"}
            </Button>
          </form>
          <nav aria-label="账号操作" className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
            {mode !== "login" && <Link className="underline underline-offset-4" href="/login">返回登录</Link>}
            {mode === "login" && <><Link className="underline underline-offset-4" href="/login?mode=register">注册账号</Link><Link className="underline underline-offset-4" href="/login?mode=forgot">忘记密码</Link></>}
          </nav>
        </CardContent>
      </Card>
    </div>
  );
}
