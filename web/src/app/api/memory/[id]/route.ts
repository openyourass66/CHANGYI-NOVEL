import { withAccount } from "@/lib/access";
import { fail, handleError, ok, readJson } from "@/lib/api";
import {
  deleteMemoryEntry,
  getMemoryEntry,
  memoryInputSchema,
  updateMemoryEntry,
} from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handleGET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const entry = await getMemoryEntry(id);
    if (!entry) return fail("记忆条目不存在。", 404);
    return ok({ entry });
  } catch (error) {
    return handleError(error);
  }
}

async function handlePATCH(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const input = memoryInputSchema.parse(await readJson(request));
    return ok({ entry: await updateMemoryEntry(id, input) });
  } catch (error) {
    return handleError(error);
  }
}

async function handleDELETE(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await deleteMemoryEntry(id);
    return ok({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}

export const GET = withAccount("memory", handleGET);
export const PATCH = withAccount("memory", handlePATCH);
export const DELETE = withAccount("memory", handleDELETE);
