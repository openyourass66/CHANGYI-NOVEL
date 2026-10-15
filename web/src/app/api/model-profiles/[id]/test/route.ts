import { fail, handleError, ok } from "@/lib/api";
import { resolveProfile, runChat } from "@/lib/ai/client";
import { recordProfileCheck } from "@/lib/ai/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 连接测试：发一个极小请求，验证地址与密钥可用。 */
export async function POST(_request: Request, { params }: Ctx) {
  const { id } = await params;
  let profile;
  try {
    profile = await resolveProfile(id);
  } catch (error) {
    return handleError(error);
  }
  try {
    const res = await runChat(profile, {
      messages: [{ role: "user", content: "回复“ok”两个字符即可。" }],
      maxTokens: 16,
      temperature: 0,
    });
    await recordProfileCheck(id, true, `${profile.model} 响应正常`);
    return ok({ ok: true, sample: res.text.slice(0, 120) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    await recordProfileCheck(id, false, message).catch(() => undefined);
    return fail(message, 502);
  }
}
