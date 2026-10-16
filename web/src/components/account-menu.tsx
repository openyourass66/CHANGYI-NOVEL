"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/operation-prompt";

export function AccountMenu() {
  const { data, isPending } = authClient.useSession();
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  if (isPending) return <span className="text-xs text-muted-foreground" role="status">正在读取账号…</span>;
  if (!data) return <Button variant="ghost" size="sm" asChild><Link href="/login">登录</Link></Button>;
  return (
    <div className="flex items-center gap-2">
      <span className="hidden max-w-36 truncate text-sm text-muted-foreground sm:block">{data.user.name}</span>
      <Button variant="ghost" size="sm" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          const result = await authClient.signOut();
          if (result.error) throw new Error();
          router.replace("/login");
          router.refresh();
        } catch {
          notify.error("退出失败，请重试。");
          setBusy(false);
        }
      }}>{busy ? "正在退出…" : "退出登录"}</Button>
    </div>
  );
}
