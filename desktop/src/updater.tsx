import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Phase = "idle" | "checking" | "latest" | "available" | "downloading" | "ready" | "installing";
const UpdateContext = createContext<{ version: string; phase: Phase; error: string; checkNow: () => void; show: () => void } | null>(null);

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [progress, setProgress] = useState({ received: 0, total: 0 });
  const update = useRef<Update | null>(null);
  const busy = useRef(false);

  async function checkNow(manual = false) {
    if (!isTauri() || busy.current) return;
    if (update.current) { if (manual) setOpen(true); return; }
    busy.current = true;
    setPhase("checking");
    setError("");
    try {
      update.current = await check({ timeout: 20_000 });
      setPhase(update.current ? "available" : "latest");
      if (update.current) setOpen(true);
    } catch (cause) {
      setPhase("idle");
      if (manual) setError(`检查更新失败，请检查网络后重试。${String(cause)}`);
    } finally { busy.current = false; }
  }

  useEffect(() => {
    if (!isTauri()) return;
    void getVersion().then(setVersion).catch(() => {});
    const startup = window.setTimeout(() => void checkNow(), 5_000);
    const interval = window.setInterval(() => void checkNow(), 6 * 60 * 60 * 1000);
    return () => { clearTimeout(startup); clearInterval(interval); };
  }, []);

  async function download() {
    if (!update.current || busy.current) return;
    busy.current = true;
    setError("");
    setPhase("downloading");
    setProgress({ received: 0, total: 0 });
    try {
      await update.current.download((event) => {
        if (event.event === "Started") setProgress({ received: 0, total: event.data.contentLength ?? 0 });
        if (event.event === "Progress") setProgress((value) => ({ ...value, received: value.received + event.data.chunkLength }));
      }, { timeout: 120_000 });
      setSaved(false);
      setPhase("ready");
    } catch (cause) {
      setPhase("available");
      setError(`下载或签名校验失败，可重新下载。${String(cause)}`);
    } finally { busy.current = false; }
  }

  async function install() {
    if (!update.current || busy.current || !saved) return;
    busy.current = true;
    setPhase("installing");
    setError("");
    try {
      await invoke("prepare_update");
      await update.current.install();
    } catch (cause) {
      setError(`暂时无法安装：${String(cause)}`);
    } finally {
      await invoke("cancel_update").catch(() => {});
      busy.current = false;
      setPhase("ready");
    }
  }

  const locked = phase === "downloading" || phase === "installing";
  return <UpdateContext.Provider value={{ version, phase, error, checkNow: () => void checkNow(true), show: () => setOpen(true) }}>
    {children}
    <Dialog open={open} onOpenChange={(value) => { if (phase !== "installing") { setOpen(value); setSaved(false); } }}>
      <DialogContent showCloseButton={phase !== "installing"}>
        <DialogHeader><DialogTitle>发现新版本 {update.current?.version}</DialogTitle>
          <DialogDescription>当前版本 {version}。下载后可选择安装时间，安装将关闭并重新打开应用。</DialogDescription></DialogHeader>
        <div className="max-h-60 overflow-y-auto whitespace-pre-wrap text-sm">{update.current?.body || "此版本未提供更新说明。"}</div>
        <div aria-live="polite" className="space-y-3 text-sm">
          {phase === "downloading" && <><p>正在下载并验证更新… {progress.total ? `${Math.min(100, Math.round(progress.received / progress.total * 100))}%` : `${(progress.received / 1048576).toFixed(1)} MB`}</p>
            <progress className="w-full" aria-label="更新下载进度" max={progress.total || undefined} value={progress.total ? progress.received : undefined} /></>}
          {(phase === "ready" || phase === "installing") && <><p>更新已下载。请先保存编辑内容，并等待分析、续写任务结束或手动停止任务。</p>
            <label className="flex items-center gap-2"><input type="checkbox" checked={saved} disabled={locked} onChange={(event) => setSaved(event.target.checked)} />我已保存编辑内容，确认安装并退出</label></>}
          {error && <p role="alert" className="break-all text-destructive">{error}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={phase === "installing"} onClick={() => { setOpen(false); setSaved(false); }}>稍后</Button>
          {phase === "ready" || phase === "installing"
            ? <Button disabled={locked || !saved} onClick={() => void install()}>{phase === "installing" ? "正在安装…" : "安装并退出"}</Button>
            : <Button disabled={locked} onClick={() => void download()}>{phase === "downloading" ? "下载中…" : "下载更新"}</Button>}
        </div>
      </DialogContent>
    </Dialog>
  </UpdateContext.Provider>;
}

export function UpdateSettings() {
  const state = useContext(UpdateContext);
  if (!state) return null;
  const hasUpdate = ["available", "downloading", "ready", "installing"].includes(state.phase);
  return <Card><CardHeader><CardTitle className="text-base">关于与更新</CardTitle>
    <CardDescription>当前版本 {state.version || "—"} · 启动后及每 6 小时自动检查更新</CardDescription></CardHeader>
    <CardContent className="space-y-3"><Button variant="outline" disabled={!isTauri() || state.phase === "checking" || state.phase === "installing"}
      onClick={hasUpdate ? state.show : state.checkNow}>{hasUpdate ? "查看更新" : state.phase === "checking" ? "检查中…" : "检查更新"}</Button>
      <p className="text-sm text-muted-foreground" role="status">{!isTauri() ? "请在桌面应用中检查更新。" : state.phase === "latest" ? "当前已是最新版本。" : hasUpdate ? "有新版本可用。" : ""}</p>
      {state.error && <p role="alert" className="break-all text-sm text-destructive">{state.error}</p>}
    </CardContent></Card>;
}
