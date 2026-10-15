import { withAccount } from "@/lib/access";
import { fail, handleError, ok, readJson } from "@/lib/api";
import {
  chapterUpdateSchema,
  deleteChapter,
  getChapterView,
  updateChapter,
} from "@/lib/chapters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handleGET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const chapter = await getChapterView(id);
    if (!chapter) return fail("章节不存在。", 404);
    return ok({ chapter });
  } catch (error) {
    return handleError(error);
  }
}

async function handlePATCH(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const input = chapterUpdateSchema.parse(await readJson(request));
    return ok({ chapter: await updateChapter(id, input) });
  } catch (error) {
    return handleError(error);
  }
}

async function handleDELETE(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await deleteChapter(id);
    return ok({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}

export const GET = withAccount("chapter", handleGET);
export const PATCH = withAccount("chapter", handlePATCH);
export const DELETE = withAccount("chapter", handleDELETE);
