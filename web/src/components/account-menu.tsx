"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { apiFetch } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/operation-prompt";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AccountMenu() {
  const { data, isPending } = authClient.useSession();
  const [busy, setBusy] = useState(false);
  const [avatar, setAvatar] = useState<{ userId: string; url: string } | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const userId = data?.user.id;

  useEffect(() => {
    if (!userId) return;
    let active = true;
    let requestId = 0;
    let objectUrl: string | null = null;
    const refreshAvatar = () => {
      const currentRequest = ++requestId;
      void apiFetch("/api/v1/profile/avatar").then(async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("头像暂时无法读取。");
        return URL.createObjectURL(await response.blob());
      }).then((url) => {
        if (!active || currentRequest !== requestId) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        setAvatar(url ? { userId, url } : null);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = url;
      }).catch(() => { /* 保留默认图标或上一次成功读取的头像 */ });
    };
    refreshAvatar();
    window.addEventListener("changyi:avatar-updated", refreshAvatar);
    return () => {
      active = false;
      requestId++;
      window.removeEventListener("changyi:avatar-updated", refreshAvatar);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [userId]);

  if (isPending) return <span className="text-xs text-muted-foreground" role="status">正在读取账号…</span>;
  if (!data) return <Button variant="ghost" size="sm" asChild><Link href="/login">登录</Link></Button>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={`h-10 max-w-40 gap-2 px-3 data-[state=open]:bg-accent sm:max-w-52 ${pathname.startsWith("/profile") ? "bg-accent" : ""}`}
          disabled={busy}
          aria-label={`账号菜单：${data.user.name}`}
        >
          <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground ring-1 ring-border">
            {avatar?.userId === data.user.id
              ? <img src={avatar.url} alt="" className="size-full object-cover" />
              : <UserRound className="size-4" aria-hidden />}
          </span>
          <span className="min-w-0 truncate">{busy ? "正在退出…" : data.user.name}</span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem asChild>
          <Link href="/profile" aria-current={pathname.startsWith("/profile") ? "page" : undefined}>
            <UserRound className="size-4" aria-hidden />个人信息
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={busy} onSelect={async () => {
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
        }}>
          <LogOut className="size-4" aria-hidden />退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
