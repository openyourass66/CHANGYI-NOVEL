import { handleError, ok, readJson } from "@/lib/api";
import { deleteProfile, profileInputSchema, updateProfile } from "@/lib/ai/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = (await readJson(request)) as Record<string, unknown>;
    const parsed = profileInputSchema.partial().parse(body);
    const profile = await updateProfile(id, {
      ...parsed,
      clearApiKey: body.clearApiKey === true,
    });
    return ok({ profile });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await deleteProfile(id);
    return ok({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
