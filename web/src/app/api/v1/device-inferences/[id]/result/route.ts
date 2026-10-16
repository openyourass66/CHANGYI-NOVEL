import { z } from "zod";
import { withAccount } from "@/lib/access";
import { requireUser } from "@/lib/auth-session";
import { ok, readJson } from "@/lib/api";
import { finishDeviceInference } from "@/lib/ai/device-inference";
export const runtime = "nodejs";
const usage = z.object({ promptTokens: z.number().int().nonnegative().optional(), completionTokens: z.number().int().nonnegative().optional(), totalTokens: z.number().int().nonnegative().optional() });
export const POST = withAccount("account", async (request, context) => {
  const input = z.object({ deviceId: z.string().uuid(), leaseToken: z.string().regex(/^[a-f0-9]{64}$/), result: z.object({ text: z.string().min(1).max(8_000_000), usage }).optional(), error: z.string().max(400).optional() }).refine(v => Boolean(v.result) !== Boolean(v.error), "必须提交结果或错误之一。").parse(await readJson(request));
  await finishDeviceInference((await requireUser()).id, (await context.params).id, input);
  return ok({ ok: true });
});
