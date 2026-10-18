"use client";

import { useRef, useState } from "react";
import { useRouter } from "@/compat/navigation";
import { notify } from "@/components/operation-prompt";
import { FileUp, Loader2, UploadCloud } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supportedExtensions } from "@/lib/import/formats";

export function ImportPanel({
  projectId,
  compact = false,
  onImported,
}: {
  projectId: string;
  compact?: boolean;
  onImported?: (result: { chapterCount: number }) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  function pick(f: File | null) {
    if (!f) return;
    setFile(f);
  }

  async function upload() {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/import`, {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as {
        result?: { chapterCount: number };
        error?: string;
      };
      if (!res.ok || !data.result) throw new Error(data.error ?? "导入失败");
      notify.success(`已解析 ${data.result.chapterCount} 个章节`);
      setFile(null);
      onImported?.(data.result);
      router.refresh();
    } catch (err) {
      notify.error(err instanceof Error ? err.message : "导入失败");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={cn("space-y-4", compact && "space-y-3")}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files?.[0] ?? null);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-6 text-center transition-colors duration-200",
          compact ? "py-6" : "py-12",
          dragging ? "border-primary bg-accent/60" : "border-border hover:border-primary/50",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={supportedExtensions()}
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
        <UploadCloud className="size-8 text-muted-foreground" aria-hidden />
        <div>
          <p className="font-medium">
            {file ? file.name : "点击选择或拖入文件"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            支持 {supportedExtensions().replaceAll(",", "、")}；单文件不超过 50MB
          </p>
        </div>
        {file && (
          <p className="text-xs text-muted-foreground">
            {(file.size / 1024).toFixed(0)} KB
          </p>
        )}
      </div>

      <Alert>
        <AlertDescription className="text-xs">
          扫描版 PDF 暂不支持 OCR。原文导入后只读保存，解析结果可人工校正。
        </AlertDescription>
      </Alert>

      <div className="flex justify-end">
        <Button onClick={upload} disabled={!file || uploading}>
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileUp className="size-4" />
          )}
          {uploading ? "解析中…" : "导入并解析"}
        </Button>
      </div>
    </div>
  );
}
