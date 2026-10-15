import { withAccount } from "@/lib/access";
import { handleError, ok, readJson } from "@/lib/api";
import { deleteProfile, profileInputSchema, updateProfile } from "@/lib/ai/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handlePATCH(request: Request, { params }: Ctx) {
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

async function handleDELETE(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await deleteProfile(id);
    return ok({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}

export const PATCH = withAccount("profile", handlePATCH);
export const DELETE = withAccount("profile", handleDELETE);
