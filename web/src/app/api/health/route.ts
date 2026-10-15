import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { DATA_DIR } from "@/lib/storage";
import { authRedisStorage } from "@/lib/auth-redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await Promise.all([prisma.$queryRaw`SELECT 1`, access(DATA_DIR, constants.W_OK), authRedisStorage.get("health:probe")]);
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
