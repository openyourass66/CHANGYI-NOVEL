"use client";

import { useState } from "react";
import { notify } from "@/components/operation-prompt";
import {
  Download,
  Loader2,
  Pencil,
  RotateCcw,
  Save,
  ScrollText,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { DraftChapterView } from "@/lib/continuation-view";

/** 单章草稿的阅读 / 编辑对话框。保存走 PATCH，正文一改即 version+1。 */
export function DraftEditor({
  draft,
  open,
  regenerating,
  onOpenChange,
  onSaved,
  onDeleted,
  onRegenerate,
  onExportText,
}: {
  draft: DraftChapterView;
  open: boolean;
  regenerating: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (draft: DraftChapterView) => void;
  onDeleted: (id: string) => void;
  onRegenerate: () => void;
  onExportText?: (fileName: string, text: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [title, setTitle] = useState(draft.title ?? "");
  const [content, setContent] = useState(draft.content);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const dirty = title !== (draft.title ?? "") || content !== draft.content;

  async function save() {
    if (!content.trim()) {
      notify.error("草稿正文不能为空。");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${draft.projectId}/drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() || null, content }),
      });
      const data = (await res.json()) as { draft?: DraftChapterView; error?: string };
      if (!res.ok || !data.draft) throw new Error(data.error ?? "保存失败");
      const saved = data.draft;
      onSaved(saved);
      setTitle(saved.title ?? "");
      setContent(saved.content);
      setMode("read");
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${draft.projectId}/drafts/${draft.id}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "删除失败");
      onDeleted(draft.id);
      notify.success("已删除该草稿");
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  function exportText() {
    const body = `第 ${draft.index} 章　${title || "（无标题）"}\n\n${content}\n`;
    const fileName = `第${draft.index}章-${(title || "草稿").replace(/[\\/:*?"<>|]/g, "_")}.txt`;
    if (onExportText) {
      void onExportText(fileName, body).catch((error: unknown) => notify.error(error instanceof Error ? error.message : String(error)));
      return;
    }
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  const busy = saving || deleting || regenerating;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>第 {draft.index} 章</span>
            <Badge variant="secondary" className="text-xs">
              v{draft.version}
            </Badge>
            <Badge variant="outline" className="text-xs font-normal">
              {content.length} 字
            </Badge>
            {dirty && (
              <Badge variant="outline" className="text-xs text-warning">
                有未保存的修改
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            在此阅读、编辑或重新生成本章草稿。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant={mode === "read" ? "default" : "outline"}
              onClick={() => setMode("read")}
            >
              <ScrollText className="size-4" />
              阅读
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "edit" ? "default" : "outline"}
              onClick={() => setMode("edit")}
            >
              <Pencil className="size-4" />
              编辑
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={exportText} disabled={busy}>
              <Download className="size-4" />
              导出
            </Button>
            <Button variant="outline" size="sm" onClick={onRegenerate} disabled={busy}>
              {regenerating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCcw className="size-4" />
              )}
              重新生成
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void remove()} disabled={busy}>
              <Trash2 className="size-4" />
              删除
            </Button>
          </div>
        </div>

        <Separator />

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          {mode === "read" ? (
              <div>
                <h2 className="mb-3 text-lg font-semibold">{title || "（无标题）"}</h2>
                <div className="reading-surface space-y-3 text-[15px]">
                  <p className="whitespace-pre-wrap">{content}</p>
                </div>
              </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="draft-title">章标题</Label>
                <Input
                  id="draft-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="章标题"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="draft-content">正文</Label>
                <Textarea
                  id="draft-content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={20}
                  className="reading-surface text-[15px]"
                />
              </div>
            </div>
          )}
        </div>

        {mode === "edit" && (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setTitle(draft.title ?? "");
                setContent(draft.content);
                setMode("read");
              }}
              disabled={busy}
            >
              放弃修改
            </Button>
            <Button onClick={() => void save()} disabled={busy || !dirty}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              保存
            </Button>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
