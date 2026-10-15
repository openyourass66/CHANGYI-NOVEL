import { fail, handleError, ok } from "@/lib/api";
import { restoreProjectFromExport } from "@/lib/restore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BACKUP_BYTES = 200 * 1024 * 1024; // 200MB

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return fail("未收到备份文件。", 400);
    }
    if (file.size > MAX_BACKUP_BYTES) {
      return fail(`备份文件过大（上限 ${MAX_BACKUP_BYTES / 1024 / 1024}MB）。`, 413);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      return fail("备份文件不是合法的 JSON。", 400);
    }
    const summary = await restoreProjectFromExport(parsed);
    return ok({ project: { id: summary.projectId, name: summary.projectName }, summary }, {
      status: 201,
    });
  } catch (error) {
    return handleError(error);
  }
}
