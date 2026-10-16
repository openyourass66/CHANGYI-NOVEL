"use client";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfileManager } from "@/components/settings/profile-manager";

import type { SettingsView } from "@contracts/workspace";
export function SettingsPanel({profiles,encryptionReady,serverOnly}: SettingsView) {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-4 py-8 lg:px-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
        <p className="text-sm text-muted-foreground">
          管理自己账号的模型接入与数据隐私。
        </p>
      </header>

      {!encryptionReady && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>尚未配置主密钥</AlertTitle>
          <AlertDescription>
            在 <code className="font-mono">.env</code> 中设置 64 位十六进制的{" "}
            <code className="font-mono">APP_ENCRYPTION_KEY</code> 后重启，才能安全保存模型密钥。
          </AlertDescription>
        </Alert>
      )}

      <ProfileManager profiles={profiles} encryptionReady={encryptionReady} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
            数据与隐私
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            原文只读保存，分析与记忆作为独立数据记录。调用云端模型前会展示服务商与本次将发送的数据范围并请求授权；
            外部模型 API 由你提供密钥并承担供应商费用。模型密钥按账号在服务端加密保存，不进入客户端包、项目导出或日志。
          </p>
          <p>
            {serverOnly
              ? "当前服务保存项目正文与生成结果。Ollama / LM Studio 由 Windows 客户端在当前设备执行；请在使用设备上配置并测试连接。项目正文和结果保存在服务端。"
              : "本地模型由当前本机服务访问，推理请求不外发；项目正文与保存结果仍保存在本机数据库中。"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
