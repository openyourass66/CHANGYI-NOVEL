"use client";
import { apiFetch } from "@/lib/client-api";


import { useRef, useState } from "react";
import { toast } from "sonner";
import { History, Loader2, MapPin, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  MEMORY_CATEGORY,
  MEMORY_CATEGORY_DEFAULT_STATUS,
  MEMORY_CATEGORY_STATUS,
  MEMORY_STATUS,
  toneClass,
} from "@/lib/domain";
import { MEMORY_STATUS_TONE, type MemoryCategory, type MemoryStatus } from "@/lib/domain";
import type { MemoryEntryView } from "@/lib/memory-view";

export type ChapterOption = { id: string; index: number; title: string };

type DraftCitation = {
  chapterId: string;
  excerpt: string;
  startOffset: number;
  endOffset: number;
};

const dateFmt = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function MemoryEditor({
  projectId,
  chapters,
  entry,
  defaultCategory,
  onClose,
  onSaved,
  onDeleted,
}: {
  projectId: string;
  chapters: ChapterOption[];
  entry: MemoryEntryView | null;
  defaultCategory: MemoryCategory;
  onClose: () => void;
  onSaved: (entry: MemoryEntryView) => void;
  onDeleted: (id: string) => void;
}) {
  const editing = Boolean(entry);
  const [category, setCategory] = useState<MemoryCategory>(entry?.category ?? defaultCategory);
  const [key, setKey] = useState(entry?.key ?? "");
  const [title, setTitle] = useState(entry?.title ?? "");
  const [content, setContent] = useState(entry?.content ?? "");
  const [status, setStatus] = useState<MemoryStatus>(
    entry?.status ?? MEMORY_CATEGORY_DEFAULT_STATUS[defaultCategory],
  );
  const [citations, setCitations] = useState<DraftCitation[]>(
    (entry?.citations ?? []).map((c) => ({
      chapterId: c.chapterId,
      excerpt: c.excerpt,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [history, setHistory] = useState<MemoryEntryView[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const contentCache = useRef(new Map<string, string>());

  const statusOptions = MEMORY_CATEGORY_STATUS[category];

  function changeCategory(next: MemoryCategory) {
    setCategory(next);
    if (!MEMORY_CATEGORY_STATUS[next].includes(status)) {
      setStatus(MEMORY_CATEGORY_DEFAULT_STATUS[next]);
    }
    if (!key.trim()) setKey(slugFor(next));
  }

  function slugFor(cat: MemoryCategory): string {
    return `${cat}-${Date.now().toString(36)}`;
  }

  function addCitation() {
    const first = chapters[0]?.id ?? "";
    setCitations((prev) => [
      ...prev,
      { chapterId: first, excerpt: "", startOffset: 0, endOffset: 0 },
    ]);
  }

  function updateCitation(index: number, patch: Partial<DraftCitation>) {
    setCitations((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    );
  }

  function removeCitation(index: number) {
    setCitations((prev) => prev.filter((_, i) => i !== index));
  }

  async function loadChapterContent(chapterId: string): Promise<string> {
    const cached = contentCache.current.get(chapterId);
    if (cached !== undefined) return cached;
    const res = await apiFetch(`/api/chapters/${chapterId}`, { cache: "no-store" });
    const data = (await res.json()) as { chapter?: { content: string } };
    const content = data.chapter?.content ?? "";
    contentCache.current.set(chapterId, content);
    return content;
  }

  async function locate(index: number) {
    const c = citations[index];
    const excerpt = c.excerpt.trim();
    if (!c.chapterId || !excerpt) {
      toast.error("请先选择章节并填写片段");
      return;
    }
    try {
      const text = await loadChapterContent(c.chapterId);
      const at = text.indexOf(excerpt);
      if (at < 0) {
        toast.error("未在该章节中找到该片段，请核对文字");
        return;
      }
      updateCitation(index, { startOffset: at, endOffset: at + excerpt.length });
      toast.success(`已定位到第 ${at} 字`);
    } catch {
      toast.error("定位失败");
    }
  }

  async function save() {
    if (!content.trim()) {
      toast.error("内容不能为空");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        category,
        key: key.trim() || undefined,
        title: title.trim() || undefined,
        content: content.trim(),
        status,
        citations: citations.map((c) => ({
          chapterId: c.chapterId,
          excerpt: c.excerpt.trim(),
          startOffset: c.startOffset,
          endOffset: c.endOffset,
        })),
      };
      const res = await apiFetch(editing ? `/api/memory/${entry!.id}` : `/api/projects/${projectId}/memory`, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { entry?: MemoryEntryView; error?: string };
      if (!res.ok || !data.entry) throw new Error(data.error ?? "保存失败");
      toast.success(editing ? "已保存新版本" : "已创建记忆条目");
      onSaved(data.entry);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function doDelete() {
    if (!entry) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/memory/${entry.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      toast.success("条目及其历史版本已删除");
      onDeleted(entry.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function openHistory() {
    if (!entry) return;
    setLoadingHistory(true);
    try {
      const res = await apiFetch(`/api/memory/${entry.id}/history`, { cache: "no-store" });
      const data = (await res.json()) as { history?: MemoryEntryView[] };
      setHistory(data.history ?? []);
    } catch {
      toast.error("加载历史失败");
    } finally {
      setLoadingHistory(false);
    }
  }

  async function restore(revision: number) {
    if (!entry) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/memory/${entry.id}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision }),
      });
      const data = (await res.json()) as { entry?: MemoryEntryView; error?: string };
      if (!res.ok || !data.entry) throw new Error(data.error ?? "恢复失败");
      toast.success(`已恢复到第 ${revision} 版`);
      onSaved(data.entry);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "恢复失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑记忆条目" : "新建记忆条目"}</DialogTitle>
          <DialogDescription>
            推断与未知须如实标注，不得把推断当作明述事实。保存将生成新的版本。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mem-category">分类</Label>
              <Select value={category} onValueChange={(v) => changeCategory(v as MemoryCategory)}>
                <SelectTrigger id="mem-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(MEMORY_CATEGORY) as MemoryCategory[]).map((c) => (
                    <SelectItem key={c} value={c}>
                      {MEMORY_CATEGORY[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mem-status">状态</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as MemoryStatus)}>
                <SelectTrigger id="mem-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {MEMORY_STATUS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mem-title">标题</Label>
              <Input
                id="mem-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：林舟"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mem-key">键（同名归并）</Label>
              <Input
                id="mem-key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="稳定标识，便于同类合并"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mem-content">
              内容 <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="mem-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              placeholder="记录设定、人物、时间线或线索…"
            />
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>出处（原文定位）</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addCitation}
                disabled={chapters.length === 0}
              >
                <Plus className="size-4" />
                添加出处
              </Button>
            </div>
            {chapters.length === 0 && (
              <p className="text-xs text-muted-foreground">尚无章节，无法添加出处。</p>
            )}
            {citations.length === 0 && chapters.length > 0 && (
              <p className="text-xs text-muted-foreground">
                可粘贴原文片段并点击定位，自动记录章节与字符偏移。
              </p>
            )}
            {citations.map((c, i) => (
              <div key={i} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Select
                    value={c.chapterId}
                    onValueChange={(v) => updateCitation(i, { chapterId: v })}
                  >
                    <SelectTrigger className="flex-1" aria-label={`出处 ${i + 1} 章节`}>
                      <SelectValue placeholder="选择章节" />
                    </SelectTrigger>
                    <SelectContent>
                      {chapters.map((ch) => (
                        <SelectItem key={ch.id} value={ch.id}>
                          第 {ch.index} 章 · {ch.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label={`删除出处 ${i + 1}`}
                    onClick={() => removeCitation(i)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                <Textarea
                  value={c.excerpt}
                  onChange={(e) => updateCitation(i, { excerpt: e.target.value })}
                  rows={2}
                  placeholder="粘贴原文片段"
                  aria-label={`出处 ${i + 1} 片段`}
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {c.startOffset} – {c.endOffset}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => locate(i)}
                    disabled={!c.excerpt.trim()}
                  >
                    <MapPin className="size-4" />
                    定位
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {editing && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>历史版本</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={openHistory}
                    disabled={loadingHistory}
                  >
                    {loadingHistory ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <History className="size-4" />
                    )}
                    查看历史
                  </Button>
                </div>
                {history && (
                  <ul className="space-y-2">
                    {history.map((h) => (
                      <li
                        key={h.id}
                        className="flex items-start justify-between gap-2 rounded-md border p-2.5 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="flex items-center gap-2">
                            <span className="font-mono text-xs text-muted-foreground">
                              v{h.revision}
                            </span>
                            <Badge
                              variant="outline"
                              className={toneClass(MEMORY_STATUS_TONE[h.status] ?? "muted")}
                            >
                              {MEMORY_STATUS[h.status]}
                            </Badge>
                            {h.id === entry?.id && (
                              <span className="text-xs text-muted-foreground">当前</span>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {dateFmt.format(new Date(h.updatedAt))}
                            </span>
                          </p>
                          <p className="mt-1 line-clamp-2 text-muted-foreground">{h.content}</p>
                        </div>
                        {h.id !== entry?.id && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => restore(h.revision)}
                            disabled={saving}
                          >
                            <RotateCcw className="size-3.5" />
                            恢复
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {editing ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
              disabled={saving || deleting}
            >
              <Trash2 className="size-4" />
              删除
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button type="button" onClick={save} disabled={saving}>
              {saving ? "保存中…" : editing ? "保存新版本" : "创建"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除记忆条目？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除该条目及其全部历史版本，无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void doDelete();
              }}
            >
              {deleting ? "删除中…" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
