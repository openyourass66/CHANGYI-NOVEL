"use client";

import { useEffect, useState } from "react";
import { FolderOpen, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function StorageSettings() {
  const [info, setInfo] = useState<DesktopStorageInfo | null>(null);
  const [directory, setDirectory] = useState("");
  const [source, setSource] = useState("");
  const [action, setAction] = useState<"move" | "open" | "import">("move");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const api = window.changyiDesktop;
    if (!api) return;
    void api.getStorage().then((result) => {
      if (result.ok && result.value.supported) {
        setInfo(result.value);
        setDirectory(result.value.dataDir);
        setSource(result.value.sources[0]?.directory ?? "");
      }
    }).catch(() => setError("无法读取数据目录，请重新打开设置页。"));
  }, []);

  async function choose(purpose: "source" | "destination") {
    setError("");
    try {
      const result = await window.changyiDesktop!.chooseDirectory(purpose);
      if (!result.ok) { setError(result.error); return; }
      if (result.value) {
        if (purpose === "source") { setSource(result.value); setAction("import"); }
        else setDirectory(result.value);
      }
    } catch { setError("无法打开文件夹选择窗口，请重试。"); }
  }
  async function apply() {
    if (!directory) { setError("请先选择数据保存目录。"); return; }
    if (action === "import" && !source) { setError("请选择原数据目录。"); return; }
    setPending(true);
    setError("");
    try {
      const result = await window.changyiDesktop!.applyStorage({ directory, action, sourceDirectory: source });
      if (!result.ok) setError(result.error);
    } catch { setError("目录更改未完成，请查看当前工作区或重试。"); }
    finally { setPending(false); }
  }
  if (!info) return null;
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FolderOpen className="size-4" aria-hidden />数据保存位置</CardTitle></CardHeader>
      <CardContent className="space-y-5 text-sm">
        <p className="break-all text-muted-foreground">当前目录：{info.dataDir}</p>
        <div className="space-y-2">
          <Label htmlFor="storage-destination">保存文件夹</Label>
          <div className="flex flex-wrap gap-2">
            <Input id="storage-destination" value={directory} readOnly className="min-w-48 flex-1" />
            <Button variant="outline" disabled={pending} onClick={() => choose("destination")}>选择文件夹</Button>
          </div>
        </div>
        <fieldset disabled={pending} className="space-y-3">
          <legend className="mb-2 font-medium">数据处理方式</legend>
          {([
            ["move", "把当前数据迁移到新目录"],
            ["open", "打开已有目录，或在空目录创建工作区"],
            ["import", "从旧项目目录迁移数据"],
          ] as const).map(([value, label]) => (
            <label key={value} className="flex min-h-9 cursor-pointer items-center gap-2">
              <input type="radio" name="storage-action" value={value} checked={action === value} onChange={() => setAction(value)} />{label}
            </label>
          ))}
        </fieldset>
        {action === "import" && (
          <div className="space-y-2">
            <Label htmlFor="storage-source">原数据目录</Label>
            <div className="flex flex-wrap gap-2">
              <select id="storage-source" className="h-10 min-w-48 flex-1 rounded-md border bg-background px-3" value={source} disabled={pending} onChange={(event) => setSource(event.target.value)}>
                <option value="">请选择原数据目录</option>
                {info.sources.map((item) => <option key={item.directory} value={item.directory}>{item.projectCount} 个项目 · {item.directory}</option>)}
                {source && !info.sources.some((item) => item.directory === source) && <option value={source}>{source}</option>}
              </select>
              <Button variant="outline" disabled={pending} onClick={() => choose("source")}>浏览原目录</Button>
            </div>
          </div>
        )}
        <p className="text-muted-foreground">数据库、原文和模型配置会一起迁移，原目录保留作为备份。应用目录后将重新打开工作区；请先等待正在进行的任务结束。</p>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={apply} disabled={pending || !directory}>
            {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
            <span aria-live="polite">{pending ? "正在处理并重新打开…" : "应用目录并重新打开"}</span>
          </Button>
          <Button variant="outline" disabled={pending} onClick={async () => { const r = await window.changyiDesktop!.openStorage(); if (!r.ok) setError(r.error); }}>打开当前文件夹</Button>
        </div>
      </CardContent>
    </Card>
  );
}
