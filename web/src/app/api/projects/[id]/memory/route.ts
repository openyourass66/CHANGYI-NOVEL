import { withAccount } from "@/lib/access";
import { handleError, ok, readJson } from "@/lib/api";
import { isMemoryCategory, type MemoryCategory } from "@/lib/domain";
import {
  createMemoryEntry,
  findKeyConflicts,
  listMemoryEntries,
  memoryCounts,
  memoryInputSchema,
} from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handleGET(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const rawCategory = url.searchParams.get("category");
    const category: MemoryCategory | undefined =
      rawCategory && isMemoryCategory(rawCategory) ? rawCategory : undefined;
    const query = url.searchParams.get("q")?.trim() || undefined;

    const [entries, counts, conflicts] = await Promise.all([
      listMemoryEntries(id, { category, query }),
      memoryCounts(id),
      findKeyConflicts(id),
    ]);
    return ok({ entries, counts, conflicts });
  } catch (error) {
    return handleError(error);
  }
}

async function handlePOST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const input = memoryInputSchema.parse(await readJson(request));
    return ok({ entry: await createMemoryEntry(id, input) }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

export const GET = withAccount("project", handleGET);
export const POST = withAccount("project", handlePOST);
