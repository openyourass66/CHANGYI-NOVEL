import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";

export class AccessError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function userFromHeaders(requestHeaders: Headers) {
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session?.user.emailVerified) return null;
  return session.user;
}

export const currentUser = cache(async () => userFromHeaders(await headers()));

export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new AccessError("请先登录并验证邮箱。", 401);
  return user;
}

export async function requirePageUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
