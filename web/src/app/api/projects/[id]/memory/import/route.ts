import { withAccount } from "@/lib/access";
import { fail, handleError, ok } from "@/lib/api";
import { MAX_FILE_BYTES } from "@/lib/import/parsers";
import { importMemoryFiles, type ImportFileInput } from "@/lib/memory-import/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const ALLOWED_EXT = /\.(md|markdown|txt)$/i;
const MAX_FILES = 20;

async function handlePOST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const form = await request.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) return fail("未收到上传文件。", 400);
    if (files.length > MAX_FILES) return fail(`一次最多导入 ${MAX_FILES} 个文件。`, 413);

    const inputs: ImportFileInput[] = [];
    for (const file of files) {
      if (!ALLOWED_EXT.test(file.name)) {
        return fail(`不支持的文件类型：${file.name}（仅支持 .md / .markdown / .txt）。`, 415);
      }
      if (file.size > MAX_FILE_BYTES) {
        return fail(`文件过大：${file.name}（上限 ${MAX_FILE_BYTES / 1024 / 1024}MB）。`, 413);
      }
      inputs.push({ fileName: file.name, buffer: Buffer.from(await file.arrayBuffer()) });
    }

    const summary = await importMemoryFiles(id, inputs);
    return ok({ summary }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

export const POST = withAccount("project", handlePOST);
