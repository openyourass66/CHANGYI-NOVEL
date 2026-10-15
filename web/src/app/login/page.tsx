import type { Metadata } from "next";
import { AccountForm, type AccountMode } from "@/components/account-form";

export const metadata: Metadata = { title: "账号" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const modes: AccountMode[] = ["login", "register", "forgot"];
  const mode = modes.find((value) => value === query.mode) ?? "login";
  return <AccountForm key={mode} mode={mode} />;
}
