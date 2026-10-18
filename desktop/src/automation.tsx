import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useRevalidator } from "react-router-dom";
import { api } from "./bridge";
import { notify } from "@/components/operation-prompt";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CloudAuthorizeDialog } from "@/components/projects/cloud-authorize-dialog";
import type { ProfileView } from "@/lib/ai/profiles";
import type { RunPreview } from "@/lib/ai/preview";
import type { RunStatusView } from "@/lib/ai/runner";

type Settings = { autoAccept: boolean; autoSynthesis: boolean; sound: boolean };
type Workflow = { id: string; projectId: string; projectName: string; kind: string; planId?: string; status: string; currentTask: string; step: number; steps: unknown[]; run: RunStatusView | null; error?: string; notified: number; sound: boolean; updatedAt?: string };
const labels: Record<string, string> = { "chapter-extract": "逐章理解", "book-synthesis": "全书统合", outline: "生成章纲", draft: "生成正文", "continuity-check": "检查连续性", "draft-memory": "提取记忆变化", direction: "生成续写方向" };
const Context = createContext<Workflow[]>([]);
export const useWorkflows = () => useContext(Context);
let audio: AudioContext | undefined;
function unlockAudio() {
  try { audio ??= new AudioContext(); if (audio.state === "suspended") void audio.resume().catch(() => {}); } catch { /* Text feedback stays available. */ }
}
export function completionSound() {
  if (!audio || audio.state !== "running") return;
  const time = audio.currentTime;
  for (const [offset, frequency] of [[0, 1318.5], [0.09, 1760]]) {
    const tone = audio.createOscillator(); const gain = audio.createGain();
    tone.type = "sine"; tone.frequency.value = frequency;
    gain.gain.setValueAtTime(0, time + offset);
    gain.gain.linearRampToValueAtTime(0.12, time + offset + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, time + offset + 0.25);
    tone.connect(gain); gain.connect(audio.destination); tone.start(time + offset); tone.stop(time + offset + 0.27);
    tone.onended = () => { tone.disconnect(); gain.disconnect(); };
  }
}
function terminal(w: Workflow) { return ["done", "failed", "stalled"].includes(w.status); }
function message(w: Workflow) {
  if (w.status === "stalled") return "任务已中断，可继续未完成部分";
  if (w.status === "failed") return w.error || w.run?.error || "任务未能完成，请处理后继续";
  if (w.kind === "continue") return "续写完成，可以开始阅读；检查问题和记忆提案可在续写规划中查看";
  if (w.kind === "understand") return "理解分析完成；冲突及待审阅记忆可在理解分析中查看";
  return w.currentTask === "direction" ? "候选方向已生成，请选择续写方向" : `${labels[w.currentTask] ?? "任务"}完成`;
}
export function AutomationProvider({ children }: { children: ReactNode }) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [error, setError] = useState("");
  const [notices, setNotices] = useState<Workflow[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const seen = useRef(new Set<string>());
  const initialized = useRef(false);
  const revalidator = useRevalidator();
  const refresh = useRef(revalidator.revalidate); refresh.current = revalidator.revalidate;
  useEffect(() => {
    document.addEventListener("pointerdown", unlockAudio);
    document.addEventListener("keydown", unlockAudio);
    return () => { document.removeEventListener("pointerdown", unlockAudio); document.removeEventListener("keydown", unlockAudio); };
  }, []);
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const { workflows: rows } = await api<{ workflows: Workflow[] }>("/api/workflows");
        if (!active) return;
        setWorkflows(rows); setError("");
        let sound = false; let changed = false;
        for (const row of rows) {
          const key = `${row.id}:${row.status}:${row.updatedAt ?? row.run?.finishedAt ?? ""}`;
          if (terminal(row) && !row.notified && !seen.current.has(key)) {
            seen.current.add(key);
            if (initialized.current) { sound ||= row.sound; changed = true; if (row.kind === "single") setNotices((old) => [row, ...old.filter((w) => w.id !== row.id)]); }
          }
          // Retry persistence independently; a failed acknowledgement must not replay the sound.
          if (terminal(row) && !row.notified) void api(`/api/workflows/${row.id}/ack`, "POST").catch(() => {});
        }
        initialized.current = true;
        if (sound) completionSound();
        if (changed) void refresh.current();
      } catch (e) { if (active) setError(String(e)); }
      if (active) timer = setTimeout(() => void tick(), 1500);
    }
    void tick();
    return () => { active = false; clearTimeout(timer); };
  }, []);
  const visible = workflows.filter((w) => w.kind !== "single" && w.status !== "canceled" && !dismissed.includes(`${w.id}:${w.status}:${w.updatedAt}`)).slice(0, 3);
  const single = notices;
  async function action(w: Workflow, verb: "cancel" | "resume") {
    try { await api(`/api/workflows/${w.id}/${verb}`, "POST"); setError(""); }
    catch (e) { setError(String(e)); }
  }
  return <Context.Provider value={workflows}>
    {(visible.length > 0 || single.length > 0 || error) && <div className="mx-auto w-full max-w-7xl space-y-2 px-6 pt-4" aria-live="polite">
      {error && <p role="alert" className="text-sm text-destructive">任务状态暂不可用：{error}</p>}
      {[...visible, ...single].map((w) => <div key={w.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
        <div><p className="font-medium">{w.projectName} · {w.kind === "continue" ? "自动续写" : w.kind === "understand" ? "理解全书" : labels[w.currentTask]}</p>
          <p className="mt-1 text-muted-foreground">{terminal(w) ? message(w) : `${labels[w.currentTask] ?? "准备中"}${w.run ? ` · ${w.run.progress.unitsDone} / ${w.run.progress.unitsTotal}` : ""}`}</p></div>
        <div className="flex gap-2">
          {w.kind === "continue" && <Button asChild variant="outline" size="sm"><Link to={`/projects/${w.projectId}/read${w.planId ? `?plan=${w.planId}` : ""}`}>{w.status === "done" ? "开始阅读" : "阅读已完成章节"}</Link></Button>}
          {w.kind !== "single" && w.status === "running" && <Button variant="outline" size="sm" onClick={() => void action(w, "cancel")}>停止后续任务</Button>}
          {w.kind !== "single" && ["failed", "stalled"].includes(w.status) && <><Button size="sm" onClick={() => void action(w, "resume")}>继续未完成部分</Button><Button variant="outline" size="sm" onClick={() => void action(w, "cancel")}>结束此流程</Button></>}
          {terminal(w) && <Button variant="ghost" size="sm" onClick={() => { setDismissed((old) => [...old, `${w.id}:${w.status}:${w.updatedAt}`]); setNotices((old) => old.filter((n) => n.id !== w.id)); }}>收起提醒</Button>}
          {terminal(w) && <Button asChild variant="ghost" size="sm"><Link to={`/projects/${w.projectId}/${w.kind === "understand" || ["chapter-extract","book-synthesis"].includes(w.currentTask) ? "analysis" : "continuation"}`}>查看结果</Link></Button>}
        </div>
      </div>)}
    </div>}
    {children}
  </Context.Provider>;
}
export function AutomationSettings({ projectId }: { projectId: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { let active = true; void api<Settings>(`/api/projects/${projectId}/automation`).then((s) => { if (active) setSettings(s); }).catch((e) => { if (active) setError(String(e)); }); return () => { active = false; }; }, [projectId]);
  async function change(field: keyof Settings, value: boolean) {
    if (!settings) return;
    const previous = settings;
    setSettings({ ...settings, [field]: value });
    setBusy(true);
    try { setSettings(await api<Settings>(`/api/projects/${projectId}/automation`, "PATCH", { [field]: value })); setError(""); }
    catch (e) { setSettings(previous); setError(String(e)); } finally { setBusy(false); }
  }
  return <Card className="mb-4"><CardContent className="space-y-3 pt-5">
    <h2 className="font-medium">自动化配置</h2>
    <div className="flex flex-wrap gap-x-8 gap-y-3">
      {([["autoAccept","自动全部采纳分析记忆"],["autoSynthesis","分析后自动统合全书"],["sound","整项完成或需要选择时播放提醒"]] as const).map(([field,label]) => <label key={field} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={settings?.[field] ?? true} disabled={!settings || busy} onChange={(e) => void change(field,e.target.checked)} />{label}</label>)}
      <Button variant="ghost" size="sm" onClick={() => { unlockAudio(); completionSound(); }}>试听提醒</Button>
    </div>
    <p className="text-xs text-muted-foreground">配置自动保存并用于下一次任务。人工修改冲突留待处理；中间章节和自动衔接步骤保持安静。</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </CardContent></Card>;
}
export function useAutoContinue(projectId: string, profiles: ProfileView[]) {
  const [pending, setPending] = useState<{ planId: string; profileId: string; outlineCount: number } | null>(null);
  const [preview, setPreview] = useState<RunPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const start = async (args: NonNullable<typeof pending>, authorized: boolean) => {
    await api(`/api/projects/${projectId}/workflows`, "POST", { ...args, kind: "continue", authorized });
    setPending(null); setPreview(null);
  };
  const request = async (planId: string, profileId: string, outlineCount: number) => {
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) throw new Error("请先在设置中添加模型档案。");
    const args = { planId, profileId, outlineCount };
    if (profile.isLocal) { await start(args,false); return; }
    const { preview: result } = await api<{preview: RunPreview}>(`/api/projects/${projectId}/analysis/preview`, "POST", { taskType: "direction", profileId });
    setPreview({ ...result, taskLabel: "自动续写完整流程", note: `本次授权包含章纲、缺失章节正文、连续性检查和记忆变化提取。已有章纲会复用，否则规划 ${outlineCount} 章。数据包括已有故事记忆、最近原文、方向说明、章纲及本方向已生成的正文。失败后可继续未完成部分。` });
    setPending(args);
  };
  const dialog = <CloudAuthorizeDialog open={Boolean(pending)} preview={preview} authorizing={busy} onOpenChange={(open) => { if (!open) setPending(null); }} onConfirm={() => {
    if (!pending) return; setBusy(true);
    void start(pending,true).catch((e) => { notify.error(String(e)); }).finally(() => setBusy(false));
  }} />;
  return { request, dialog };
}
