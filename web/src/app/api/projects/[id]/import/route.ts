import { fail, handleError, ok } from "@/lib/api";
import { importSource } from "@/lib/import/service";
import { MAX_FILE_BYTES } from "@/lib/import/parsers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return fail("未收到上传文件。", 400);
    }
    if (file.size > MAX_FILE_BYTES) {
      return fail(`文件过大（上限 ${MAX_FILE_BYTES / 1024 / 1024}MB）。`, 413);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importSource(id, file.name, buffer);
    return ok({ result }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
