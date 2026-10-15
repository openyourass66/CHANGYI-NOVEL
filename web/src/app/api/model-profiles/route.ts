import { fail, handleError, ok, readJson } from "@/lib/api";
import { isEncryptionConfigured } from "@/lib/crypto";
import { createProfile, listProfiles, profileInputSchema } from "@/lib/ai/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const profiles = await listProfiles();
    return ok({ profiles, encryptionReady: isEncryptionConfigured() });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!isEncryptionConfigured()) {
      return fail("尚未配置主密钥 APP_ENCRYPTION_KEY，无法安全保存密钥。", 428);
    }
    const input = profileInputSchema.parse(await readJson(request));
    const profile = await createProfile(input);
    return ok({ profile }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
