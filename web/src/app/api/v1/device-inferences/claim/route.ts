import { z } from "zod";
import { withAccount } from "@/lib/access";
import { requireUser } from "@/lib/auth-session";
import { ok, readJson } from "@/lib/api";
import { claimDeviceInference } from "@/lib/ai/device-inference";
export const runtime = "nodejs";
export const POST = withAccount("account", async request => {
  const input = z.object({ deviceId: z.string().uuid() }).parse(await readJson(request));
  return ok({ job: await claimDeviceInference((await requireUser()).id, input.deviceId) });
});
