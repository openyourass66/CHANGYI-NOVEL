import Link from "@/compat/link";
import Image from "@/compat/image";
import { Suspense } from "react";
import { NavLinks } from "@/components/nav-links";
import { TokenUsage } from "@/components/token-usage";
import { ThemeToggle } from "@/components/theme-toggle";
import { TooltipProvider } from "@/components/ui/tooltip";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="app-shell">
        <header className="app-header z-40 border-b bg-background/95">
          <div className="app-titlebar flex h-14 items-center gap-5 px-4 lg:px-8">
            <Link
              href="/"
              aria-label="长亿，返回项目库"
              className="flex items-center gap-2 rounded-md px-1 font-semibold tracking-tight focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Image
                src="/app-icon-v2.png"
                width={28}
                height={28}
                alt=""
                loading="eager"
                className="size-7 shrink-0"
              />
              <span>长亿</span>
            </Link>
            <div className="h-5 w-px bg-border" aria-hidden />
            <Suspense fallback={<div className="h-10 w-52" aria-hidden />}>
              <NavLinks />
            </Suspense>
            <div className="ml-auto flex items-center gap-1">
              <TokenUsage />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main id="main" className="app-main">
          {children}
        </main>
      </div>
    </TooltipProvider>
  );
}
