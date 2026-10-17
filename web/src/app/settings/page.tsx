import type { Metadata } from "next";
import { AlertTriangle, FolderOpen, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfileManager } from "@/components/settings/profile-manager";
import { StorageSettings } from "@/components/settings/storage-settings";
import { listProfiles } from "@/lib/ai/profiles";
import { isEncryptionConfigured } from "@/lib/crypto";
import { DATA_DIR } from "@/lib/storage";

export const metadata: Metadata = { title: "设置" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [profiles, encryptionReady] = await Promise.all([
    listProfiles(),
    Promise.resolve(isEncryptionConfigured()),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-4 py-8 lg:px-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
        <p className="text-sm text-muted-foreground">
          管理模型接入、本机数据与隐私边界。
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

      <StorageSettings />
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
            本地模型请求不外发。模型密钥仅在本机服务端加密保存，不进入客户端包、项目导出或日志。
          </p>
          <p className="flex items-center gap-2">
            <FolderOpen className="size-4" aria-hidden />
            本机数据目录：
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
              {DATA_DIR}
            </code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
