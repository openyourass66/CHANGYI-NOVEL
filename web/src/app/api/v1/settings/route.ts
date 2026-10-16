import { withAccount } from "@/lib/access";
import { getSettingsView } from "@/lib/workspaces";
import { ok } from "@/lib/api";
export const runtime = "nodejs";
export const GET = withAccount("account", async () => ok(await getSettingsView()));
