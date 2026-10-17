"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft, Library, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { projectReturnPath } from "@/lib/navigation";

export function NavLinks() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const inSettings = pathname === "/settings";
  const query = searchParams.toString();
  const currentProject = projectReturnPath(`${pathname}${query ? `?${query}` : ""}`);
  const returnTo = inSettings ? projectReturnPath(searchParams.get("returnTo")) : null;
  const project = currentProject ?? returnTo;
  const settingsHref = project
    ? `/settings?${new URLSearchParams({ returnTo: project })}`
    : "/settings";
  const items = [
    { href: returnTo ?? "/", label: returnTo ? "返回项目" : "项目库", icon: returnTo ? ArrowLeft : Library, active: !inSettings, replace: Boolean(returnTo) },
    { href: settingsHref, label: "设置", icon: Settings, active: inSettings, replace: false },
  ];
  return (
    <nav aria-label="主导航" className="flex items-center gap-1">
      {items.map((item) => {
        return (
          <Link
            key={item.href}
            href={item.href}
            replace={item.replace}
            aria-current={item.active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200",
              "hover:bg-accent hover:text-accent-foreground",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              item.active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground",
            )}
          >
            <item.icon className="size-4" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
