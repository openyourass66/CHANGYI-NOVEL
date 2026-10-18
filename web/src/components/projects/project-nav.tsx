"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenCheck, BrainCircuit, Compass, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const items = [
    { href: `/projects/${projectId}`, label: "章节校对", icon: BookOpenCheck, exact: true },
    { href: `/projects/${projectId}/memory`, label: "记忆工作台", icon: BrainCircuit },
    { href: `/projects/${projectId}/analysis`, label: "理解分析", icon: Sparkles },
    { href: `/projects/${projectId}/continuation`, label: "续写规划", icon: Compass },
  ];

  return (
    <nav aria-label="项目导航" className="flex items-center gap-1">
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
