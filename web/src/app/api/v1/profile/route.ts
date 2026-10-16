import { z } from "zod";
import { withAccount } from "@/lib/access";
import { ok, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { GENDERS, readUserProfile } from "@/lib/user-profile";
import { NOVEL_GENRES } from "@contracts/api";
import { userFromHeaders } from "@/lib/auth-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const profileInput = z.object({
  name: z.string().trim().min(1, "姓名不能为空。最少 1 个字符。" ).max(40, "姓名最多 40 个字符。"),
  gender: z.enum(GENDERS).nullable(),
  age: z.number().int().min(1).max(120).nullable(),
  favoriteGenres: z.array(z.enum(NOVEL_GENRES)).max(8),
}).strict();

export const GET = withAccount("account", async (request) => {
  const user = await userFromHeaders(request.headers);
  if (!user) return Response.json({ error: "请先登录并验证邮箱。" }, { status: 401 });
  return ok({ profile: await readUserProfile(user.id) });
});

export const PATCH = withAccount("account", async (request) => {
  const user = await userFromHeaders(request.headers);
  if (!user) return Response.json({ error: "请先登录并验证邮箱。" }, { status: 401 });
  const input = profileInput.parse(await readJson(request));
  await prisma.user.update({ where: { id: user.id }, data: {
    name: input.name, gender: input.gender, age: input.age,
    favoriteGenres: JSON.stringify([...new Set(input.favoriteGenres)]),
  } });
  return ok({ profile: await readUserProfile(user.id) });
});
