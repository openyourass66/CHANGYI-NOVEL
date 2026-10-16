import { requirePageUser } from "@/lib/auth-session";
import { getSettingsView } from "@/lib/workspaces";
import { SettingsPanel } from "@/components/settings/settings-panel";
export const dynamic = "force-dynamic";
export const metadata = { title: "设置" };
export default async function SettingsPage() { await requirePageUser(); return <SettingsPanel {...await getSettingsView()} />; }
