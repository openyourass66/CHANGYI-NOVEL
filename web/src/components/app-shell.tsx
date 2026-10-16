import Link from "next/link";
import { Feather } from "lucide-react";
import { NavLinks } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";
import { AccountMenu } from "@/components/account-menu";
import { TooltipProvider } from "@/components/ui/tooltip";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-sm">
          <div className="flex h-14 items-center gap-4 px-4 lg:px-6">
            <Link
              href="/"
              className="flex items-center gap-2 rounded-md px-1 font-semibold tracking-tight focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Feather className="size-5 text-primary" aria-hidden />
              <span>长忆</span>
            </Link>
            <div className="h-5 w-px bg-border" aria-hidden />
            <NavLinks />
            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
              <AccountMenu />
            </div>
          </div>
        </header>
        <main id="main" className="flex-1">
          {children}
        </main>
      </div>
    </TooltipProvider>
  );
}
