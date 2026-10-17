"use client";

import { useEffect, useState } from "react";
import { FolderOpen, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function StorageSettings() {
  const [info, setInfo] = useState<DesktopStorageInfo | null>(null);
  const [directory, setDirectory] = useState("");
  const [pending, setPending] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const api = window.changyiDesktop;
    if (!api) return;
    void api.getStorage().then((result) => {
      if (result.ok && result.value.supported) {
        setInfo(result.value);
        setDirectory(result.value.dataDir);
      }
    }).catch(() => setError("无法读取数据目录，请重新打开设置页。"));
  }, []);

  async function choose() {
    setError("");
    setChoosing(true);
    try {
      const result = await window.changyiDesktop!.chooseDirectory();
      if (!result.ok) { setError(result.error); return; }
      if (result.value) setDirectory(result.value);
    } catch { setError("无法打开文件夹选择窗口，请重试。"); }
    finally { setChoosing(false); }
  }
  async function apply() {
    if (!directory) { setError("请先选择数据保存目录。"); return; }
    setPending(true);
    setError("");
    try {
      const result = await window.changyiDesktop!.applyStorage({ directory });
      if (!result.ok) setError(result.error);
    } catch { setError("目录更改未完成，请查看当前工作区或重试。"); }
    finally { setPending(false); }
  }
  if (!info) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><FolderOpen className="size-4" aria-hidden />数据保存位置</CardTitle>
        <CardDescription>小说项目、原文和模型配置统一保存在所选文件夹中。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm" aria-busy={pending}>
        <div className="space-y-2">
          <Label htmlFor="storage-destination">保存文件夹</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id="storage-destination" value={directory} readOnly aria-describedby="storage-hint" className="h-11 min-w-0 flex-1" />
            <Button variant="outline" className="h-11 shrink-0" disabled={pending || choosing} onClick={choose}>
              <FolderOpen className="size-4" aria-hidden />{choosing ? "正在选择…" : "选择文件夹"}
            </Button>
          </div>
        </div>
        {directory !== info.dataDir && (
          <p className="break-all text-muted-foreground">当前使用：{info.dataDir}</p>
        )}
        <p id="storage-hint" className="text-muted-foreground leading-relaxed">更换到空文件夹会自动带上当前数据；选中已有工作区会直接打开。原目录会保留。</p>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button className="h-11" onClick={apply} disabled={pending || choosing || !directory || directory === info.dataDir}>
            {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
            <span aria-live="polite">{pending ? "正在保存并重新打开…" : "保存并重新打开"}</span>
          </Button>
          <Button className="h-11" variant="outline" disabled={pending || choosing} onClick={async () => {
            setError("");
            try { const r = await window.changyiDesktop!.openStorage(); if (!r.ok) setError(r.error); }
            catch { setError("无法打开当前文件夹，请重试。"); }
          }}>打开当前文件夹</Button>
        </div>
        <p className="text-xs text-muted-foreground">更换目录前，请先等待正在进行的任务结束。</p>
      </CardContent>
    </Card>
  );
}
