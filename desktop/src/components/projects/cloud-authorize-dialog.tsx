"use client";

import { Cloud, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { RunPreview } from "@/lib/ai/preview";

/** 云端模型的数据授权对话框：展示将发送什么，确认后才发起请求。 */
export function CloudAuthorizeDialog({
  open,
  preview,
  authorizing,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  preview: RunPreview | null;
  authorizing: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !authorizing && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-warning" aria-hidden />
            发送到云端前请确认
          </DialogTitle>
          <DialogDescription>
            这是一个云端模型。以下内容将被发送到远端服务商，请确认后授权。
          </DialogDescription>
        </DialogHeader>

        {preview && (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
              <dt className="text-muted-foreground">服务商</dt>
              <dd className="col-span-2 flex items-center gap-1.5">
                <Cloud className="size-3.5" aria-hidden />
                {preview.providerLabel} · {preview.model}
              </dd>
              <dt className="text-muted-foreground">任务</dt>
              <dd className="col-span-2">{preview.taskLabel}</dd>
              <dt className="text-muted-foreground">数据范围</dt>
              <dd className="col-span-2">
                {preview.unitCount} {preview.unitLabel} · {preview.totalChars} 字
                <span className="text-muted-foreground">
                  （预计提示约 {preview.estimatedPromptChars} 字）
                </span>
              </dd>
            </dl>
            {preview.note && <p className="text-muted-foreground">{preview.note}</p>}
            <div className="space-y-1">
              <p className="text-muted-foreground">样例片段</p>
              <pre className="max-h-32 overflow-auto rounded-md border bg-muted/40 p-2 text-xs whitespace-pre-wrap">
                {preview.sampleText}
              </pre>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={authorizing}>
            取消
          </Button>
          <Button onClick={onConfirm} disabled={authorizing}>
            {authorizing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ShieldAlert className="size-4" />
            )}
            授权并开始
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
