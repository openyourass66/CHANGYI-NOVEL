import { randomUUID } from "node:crypto";
import { withAccount } from "@/lib/access";
import { prisma } from "@/lib/db";
import { userFromHeaders } from "@/lib/auth-session";
import { getOssClient } from "@/lib/oss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BYTES = 5 * 1024 * 1024;
const types = {
  "image/jpeg": { ext: "jpg", signature: (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { ext: "png", signature: (b: Buffer) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  "image/webp": { ext: "webp", signature: (b: Buffer) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
} as const;

export const POST = withAccount("account", async (request) => {
  const user = await userFromHeaders(request.headers);
  if (!user) return Response.json({ error: "请先登录并验证邮箱。" }, { status: 401 });
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!(contentType in types)) return Response.json({ error: "请选择 JPG、PNG 或 WebP 图片。" }, { status: 415 });
  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return Response.json({ error: "头像大小不能超过 5 MB。" }, { status: 413 });
  const type = types[contentType as keyof typeof types];
  if (!type.signature(bytes)) return Response.json({ error: "图片格式与文件内容不匹配。" }, { status: 415 });
  const key = `avatars/${user.id}/${randomUUID()}.${type.ext}`;
  await getOssClient().put(key, bytes, { headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=300" } });
  const previous = await prisma.user.findUnique({ where: { id: user.id }, select: { avatarKey: true } });
  await prisma.user.update({ where: { id: user.id }, data: { avatarKey: key } });
  if (previous?.avatarKey?.startsWith(`avatars/${user.id}/`)) {
    try { await getOssClient().delete(previous.avatarKey); } catch { /* replaced avatar stays usable if old-object cleanup fails */ }
  }
  return Response.json({ avatarUrl: "/api/v1/profile/avatar" });
});

export const GET = withAccount("account", async (request) => {
  const user = await userFromHeaders(request.headers);
  if (!user) return new Response("Unauthorized", { status: 401 });
  const record = await prisma.user.findUnique({ where: { id: user.id }, select: { avatarKey: true } });
  if (!record?.avatarKey?.startsWith(`avatars/${user.id}/`)) return new Response(null, { status: 404 });
  const signedUrl = await getOssClient().signatureUrlV4("GET", 60, undefined, record.avatarKey);
  const response = await fetch(signedUrl, { cache: "no-store" });
  if (!response.ok || !response.body) return new Response("Avatar unavailable", { status: 502 });
  return new Response(response.body, { headers: {
    "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
});
