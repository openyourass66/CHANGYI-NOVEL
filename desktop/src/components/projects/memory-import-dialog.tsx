"use client";

import { useRef, useState } from "react";
import { useRouter } from "@/compat/navigation";
import { notify } from "@/components/operation-prompt";
import { CircleCheck, FileText, Loader2, TriangleAlert, Upload, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toneClass } from "@/lib/domain";
import { cn } from "@/lib/utils";

const ACCEPT = ".md,.markdown,.txt";

const KIND_LABEL: Record<string, string> = {
  "chapter-notes": "章节记录",
  "story-bible": "设定集",
  characters: "人物表",
  timeline: "时间线",
  "open-threads": "悬念台账",
  "style-guide": "文风指南",
  "continuation-outline": "续写大纲",
};

type FileResult = {
  fileName: string;
  kind: string | null;
  imported: number;
  skipped: number;
  knowledge: number;
  warnings: string[];
  error?: string;
};

type Summary = {
  files: FileResult[];
  totals: { imported: number; skipped: number; knowledge: number };
};

export function MemoryImportDialog({
  projectId,
  onImported,
}: {
  projectId: string;
  onImported: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);

  function reset() {
    setFiles([]);
    setSummary(null);
    setDragging(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function addFiles(incoming: FileList | null) {
    if (!incoming || incoming.length === 0) return;
    setFiles((prev) => {
      const next = [...prev];
      for (const file of Array.from(incoming)) {
        if (!next.some((f) => f.name === file.name && f.size === file.size)) next.push(file);
      }
      return next;
    });
  }

  function removeAt(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function runImport() {
    if (files.length === 0) return;
    setImporting(true);
    try {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      const res = await fetch(`/api/projects/${projectId}/memory/import`, {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as { summary?: Summary; error?: string };
      if (!res.ok || !data.summary) throw new Error(data.error ?? "导入失败");
      setSummary(data.summary);
      const { imported, skipped, knowledge } = data.summary.totals;
      if (imported + knowledge > 0) {
        notify.success(`已导入 ${imported} 条记忆、${knowledge} 条人物认知`);
        onImported();
        router.refresh();
      } else {
        notify.info(skipped > 0 ? "没有新增条目：均已存在" : "没有可导入的条目");
      }
    } catch (err) {
      notify.error(err instanceof Error ? err.message : "导入失败");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="size-4" aria-hidden />
          导入记忆文档
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>导入记忆文档</DialogTitle>
          <DialogDescription>
            解析技能产出的记忆文件并写入本项目。同一「分类 + 键」已存在时跳过，绝不覆盖已有条目。
          </DialogDescription>
        </DialogHeader>

        {summary ? (
          <div aria-live="polite" className="space-y-3">
            <p className="flex items-center gap-2 text-sm">
              {summary.totals.imported + summary.totals.knowledge > 0 && (
                <CircleCheck className="size-4 text-success" aria-hidden />
              )}
              导入 {summary.totals.imported} 条 · 跳过 {summary.totals.skipped} 条 · 新增人物认知{" "}
              {summary.totals.knowledge} 条
            </p>
            <ul role="list" className="space-y-2">
              {summary.files.map((file) => (
                <li key={file.fileName} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="font-medium break-all">{file.fileName}</span>
                    {file.kind ? (
                      <Badge variant="secondary" className="text-xs">
                        {KIND_LABEL[file.kind] ?? file.kind}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className={cn("text-xs", toneClass("warning"))}>
                        未识别
                      </Badge>
                    )}
                  </div>
                  {file.error ? (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-destructive">
                      <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                      {file.error}
                    </p>
                  ) : (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      导入 {file.imported} · 跳过 {file.skipped} · 认知 {file.knowledge}
                    </p>
                  )}
                  {file.warnings.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {file.warnings.map((warning, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-1.5 text-xs text-warning"
                        >
                          <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                          {warning}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-4">
            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(e.dataTransfer.files);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors duration-200",
                dragging ? "border-primary bg-accent/60" : "border-border hover:border-primary/50",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              )}
            >
              <input
                ref={inputRef}
                type="file"
                multiple
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => addFiles(e.target.files)}
              />
              <Upload className="size-7 text-muted-foreground" aria-hidden />
              <div>
                <p className="font-medium">点击选择或拖入记忆文件</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  支持 .md / .markdown / .txt，可一次选择多个
                </p>
              </div>
            </div>

            {files.length > 0 && (
              <ul role="list" className="space-y-2">
                {files.map((file, i) => (
                  <li
                    key={`${file.name}-${i}`}
                    className="flex items-center gap-3 rounded-md border p-2.5"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                      {(file.size / 1024).toFixed(0)} KB
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      aria-label={`移除 ${file.name}`}
                      onClick={() => removeAt(i)}
                    >
                      <X className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <Alert>
              <AlertDescription className="text-xs">
                按文件名或标题识别：章节记录、设定集、人物表、时间线、悬念台账、文风指南、续写大纲。
                无法识别的文件会被跳过，并在结果中列出。重复导入不会产生重复条目。
              </AlertDescription>
            </Alert>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-end">
          {summary ? (
            <>
              <Button type="button" variant="ghost" onClick={reset}>
                再次导入
              </Button>
              <Button type="button" onClick={() => setOpen(false)}>
                完成
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={importing}>
                取消
              </Button>
              <Button type="button" onClick={runImport} disabled={files.length === 0 || importing}>
                {importing ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Upload className="size-4" aria-hidden />
                )}
                {importing ? "导入中…" : files.length > 0 ? `导入 ${files.length} 个文件` : "导入"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
