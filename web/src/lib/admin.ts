import "server-only";
import { prisma } from "@/lib/db";
import { userFromHeaders } from "@/lib/auth-session";
import { AccessError } from "@/lib/auth-session";

export type AdminRole = "super_admin" | "operator" | "observer";

export async function requireAdmin(request: Request, write = false) {
  const user = await userFromHeaders(request.headers);
  if (!user) throw new AccessError("请先登录并验证邮箱。", 401);
  const identity = await prisma.adminIdentity.findUnique({ where: { userId: user.id }, select: { role: true } });
  if (!identity) throw new AccessError("没有管理端访问权限。", 403);
  if (write && identity.role === "observer") throw new AccessError("当前角色没有修改权限。", 403);
  if (! ["super_admin", "operator", "observer"].includes(identity.role)) throw new AccessError("管理员角色无效。", 403);
  return { user, role: identity.role as AdminRole };
}

export async function auditAdminAction(input: {
  actorId: string; action: string; targetType: string; targetId?: string | null; details?: Record<string, string | number | boolean | null>;
}) {
  await prisma.adminAuditLog.create({ data: {
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    detailJson: JSON.stringify(input.details ?? {}),
  } });
}

export function verifyAdminMutationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(process.env.ADMIN_CONSOLE_URL ?? process.env.BETTER_AUTH_URL ?? request.url).origin;
  if (origin !== expected) throw new AccessError("请求来源无效，请刷新后重试。", 403);
}

export function adminOptions() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export function adminError(error: unknown) {
  if (error instanceof AccessError) return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  return Response.json({ error: "管理端请求失败，请稍后重试。" }, { status: 500, headers: { "Cache-Control": "no-store" } });
}
