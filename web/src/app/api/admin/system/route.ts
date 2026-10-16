import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { DATA_DIR } from "@/lib/storage";
import { authRedisStorage } from "@/lib/auth-redis";
import { adminError, requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";
export function OPTIONS() { return new Response(null, { status: 204 }); }

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const [database, redis, files] = await Promise.all([
      prisma.$queryRaw`SELECT 1`.then(() => "available").catch(() => "unavailable"),
      authRedisStorage.get("admin:health:probe").then(() => "available").catch(() => "unavailable"),
      access(DATA_DIR, constants.W_OK).then(() => "available").catch(() => "unavailable"),
    ]);
    return Response.json({ database, redis, fileStorage: files, appVersion: process.env.npm_package_version ?? "0.1.0", checkedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminError(error); }
}
