"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Library, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "项目库", icon: Library, match: (p: string) => p === "/" || p.startsWith("/projects") },
  { href: "/settings", label: "设置", icon: Settings, match: (p: string) => p.startsWith("/settings") },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="主导航" className="flex items-center gap-1">
      {NAV.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200",
              "hover:bg-accent hover:text-accent-foreground",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active
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
