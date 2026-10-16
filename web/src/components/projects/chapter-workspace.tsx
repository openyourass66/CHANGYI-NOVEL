"use client";
import { DownloadLink } from "@/components/download-link";
import { apiFetch } from "@/lib/client-api";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Download,
  FileJson,
  FileText,
  Loader2,
  Merge,
  Pencil,
  RefreshCw,
  Scissors,
  Trash2,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CHAPTER_FLAG } from "@/lib/domain";
import type { ChapterSummary } from "@/lib/chapters-view";
import { ImportPanel } from "@/components/projects/import-panel";
import { ProjectNav } from "@/components/projects/project-nav";
import { cn } from "@/lib/utils";

type SourceInfo = {
  fileName: string;
  formatLabel: string;
  byteSize: number;
  encoding: string | null;
  importedAt: string;
};

const FLAG_TONE: Record<string, string> = {
  "missing-number": "border-warning/50 text-warning",
  "duplicate-number": "border-destructive/50 text-destructive",
  "out-of-order": "border-warning/50 text-warning",
  empty: "border-destructive/50 text-destructive",
  "uncertain-boundary": "border-warning/50 text-warning",
  "no-title": "border-border text-muted-foreground",
  "manual-split": "border-info/50 text-info",
};

function flagLabel(flag: string): string {
  return (CHAPTER_FLAG as Record<string, string>)[flag] ?? flag;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const dateFmt = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const FONT_SIZES = [16, 18, 20];

/** 计算选区起点在容器纯文本中的字符偏移；无有效选区返回 null。 */
function selectionOffset(container: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.startContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(container);
  pre.setEnd(range.startContainer, range.startOffset);
  const offset = pre.toString().length;
  return offset > 0 ? offset : null;
}

export function ChapterWorkspace({
  projectId,
  projectName,
  genre,
  source,
  initialChapters,
}: {
  projectId: string;
  projectName: string;
  genre: string | null;
  source: SourceInfo | null;
  initialChapters: ChapterSummary[];
}) {
  const [chapters, setChapters] = useState(initialChapters);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialChapters[0]?.id ?? null,
  );
  const [contents, setContents] = useState<Record<string, string>>({});
  const [failedIds, setFailedIds] = useState<Record<string, true>>({});
  const [busy, setBusy] = useState(false);
  const [fontSize, setFontSize] = useState(FONT_SIZES[1]);

  const [renameTarget, setRenameTarget] = useState<ChapterSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingSplitOffset, setPendingSplitOffset] = useState<number | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [mergeNext, setMergeNext] = useState<ChapterSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChapterSummary | null>(null);
  const [reimportOpen, setReimportOpen] = useState(false);

  const readerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  const selectedIndex = useMemo(
    () => chapters.findIndex((c) => c.id === selectedId),
    [chapters, selectedId],
  );
  const selected = selectedIndex >= 0 ? chapters[selectedIndex] : null;
  const nextChapter = selectedIndex >= 0 ? chapters[selectedIndex + 1] ?? null : null;
  const selectedContent = selected ? contents[selected.id] : undefined;
  const selectedFailed = selected ? Boolean(failedIds[selected.id]) : false;
  const loadingContent =
    selectedId != null && contents[selectedId] === undefined && !failedIds[selectedId];
  const flaggedCount = useMemo(
    () => chapters.filter((c) => c.flags.length > 0).length,
    [chapters],
  );

  const refreshList = useCallback(async () => {
    const res = await apiFetch(`/api/projects/${projectId}/chapters`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const data = (await res.json()) as { chapters?: ChapterSummary[] };
    if (data.chapters) {
      setChapters(data.chapters);
      setContents({});
      setFailedIds({});
      setSelectedId(data.chapters[0]?.id ?? null);
    }
  }, [projectId]);

  // 按需拉取选中章节正文
  useEffect(() => {
    if (!selectedId || contents[selectedId] !== undefined || failedIds[selectedId]) return;
    let cancelled = false;
    apiFetch(`/api/chapters/${selectedId}`, { cache: "no-store" })
      .then(async (r) => {
        const d = (await r.json()) as { chapter?: { content: string }; error?: string };
        if (!r.ok || !d.chapter) throw new Error(d.error ?? "加载失败");
        return d.chapter.content;
      })
      .then((content) => {
        if (!cancelled) {
          setContents((prev) => ({ ...prev, [selectedId]: content }));
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFailedIds((prev) => ({ ...prev, [selectedId]: true }));
        toast.error(err instanceof Error ? err.message : "加载章节正文失败");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, contents, failedIds]);

  function retryContent(id: string) {
    setFailedIds((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function onListKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (selectedIndex < 0) return;
    e.preventDefault();
    const delta = e.key === "ArrowDown" ? 1 : -1;
    const next = chapters[selectedIndex + delta];
    if (!next) return;
    setSelectedId(next.id);
    itemRefs.current.get(next.id)?.focus();
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= chapters.length) return;
    const reordered = [...chapters];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const previous = chapters;
    setChapters(reordered.map((c, i) => ({ ...c, sortOrder: i + 1 })));
    try {
      const res = await apiFetch(`/api/projects/${projectId}/chapters/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: reordered.map((c) => c.id) }),
      });
      const data = (await res.json()) as { chapters?: ChapterSummary[]; error?: string };
      if (!res.ok || !data.chapters) throw new Error(data.error ?? "排序失败");
      setChapters(data.chapters);
    } catch (err) {
      setChapters(previous);
      toast.error(err instanceof Error ? err.message : "排序失败");
    }
  }

  async function saveRename() {
    if (!renameTarget) return;
    const title = renameValue.trim();
    if (!title) {
      toast.error("标题不能为空");
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch(`/api/chapters/${renameTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawTitle: title }),
      });
      const data = (await res.json()) as { chapter?: { rawTitle: string }; error?: string };
      if (!res.ok || !data.chapter) throw new Error(data.error ?? "重命名失败");
      const id = renameTarget.id;
      setChapters((prev) =>
        prev.map((c) => (c.id === id ? { ...c, rawTitle: title } : c)),
      );
      setRenameTarget(null);
      toast.success("标题已更新");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "重命名失败");
    } finally {
      setBusy(false);
    }
  }

  async function doSplit() {
    if (!selected || pendingSplitOffset == null) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/chapters/${selected.id}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ atOffset: pendingSplitOffset }),
      });
      const data = (await res.json()) as { chapters?: ChapterSummary[]; error?: string };
      if (!res.ok || !data.chapters) throw new Error(data.error ?? "拆分失败");
      setChapters(data.chapters);
      setContents({});
      toast.success("已按选区拆分");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "拆分失败");
    } finally {
      setBusy(false);
      setSplitOpen(false);
      setPendingSplitOffset(null);
    }
  }

  async function doMerge() {
    if (!selected || !mergeNext) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/chapters/${selected.id}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nextId: mergeNext.id }),
      });
      const data = (await res.json()) as { chapters?: ChapterSummary[]; error?: string };
      if (!res.ok || !data.chapters) throw new Error(data.error ?? "合并失败");
      setChapters(data.chapters);
      setContents({});
      toast.success("已与下一章合并");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "合并失败");
    } finally {
      setBusy(false);
      setMergeNext(null);
    }
  }

  async function doDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/chapters/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "删除失败");
      }
      const remaining = chapters.filter((c) => c.id !== deleteTarget.id);
      setChapters(remaining);
      setContents((prev) => {
        const next = { ...prev };
        delete next[deleteTarget.id];
        return next;
      });
      if (selectedId === deleteTarget.id) {
        setSelectedId(remaining[0]?.id ?? null);
      }
      toast.success("章节已删除");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  }

  function captureSelection() {
    const offset = readerRef.current ? selectionOffset(readerRef.current) : null;
    setPendingSplitOffset(offset);
  }

  if (chapters.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 lg:px-6">
        <ProjectNav projectId={projectId} />
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{projectName}</h1>
          <p className="text-sm text-muted-foreground">
            尚未导入原文。导入后系统会自动识别章节，你可逐章校对。
          </p>
        </header>
        <Card>
          <CardContent className="pt-6">
            <ImportPanel
              projectId={projectId}
              onImported={refreshList}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const headPreview =
    selectedContent && pendingSplitOffset != null
      ? selectedContent.slice(Math.max(0, pendingSplitOffset - 30), pendingSplitOffset).trim()
      : "";
  const tailPreview =
    selectedContent && pendingSplitOffset != null
      ? selectedContent.slice(pendingSplitOffset, pendingSplitOffset + 30).trim()
      : "";

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 lg:px-6">
      <ProjectNav projectId={projectId} />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{projectName}</h1>
            {genre && <Badge variant="secondary">{genre}</Badge>}
          </div>
          {source && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <FileText className="size-3.5" aria-hidden />
              <span>{source.fileName}</span>
              <span aria-hidden>·</span>
              <span>{source.formatLabel}</span>
              <span aria-hidden>·</span>
              <span>{formatBytes(source.byteSize)}</span>
              {source.encoding && (
                <>
                  <span aria-hidden>·</span>
                  <span>{source.encoding}</span>
                </>
              )}
              <span aria-hidden>·</span>
              <span>导入于 {dateFmt.format(new Date(source.importedAt))}</span>
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            共 {chapters.length} 章
            {flaggedCount > 0 && (
              <span className="text-warning"> · {flaggedCount} 章有标记待校对</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="size-4" />
                导出
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <DownloadLink href={`/api/projects/${projectId}/export?format=txt`}>
                  <FileText className="size-4" />
                  导出校对后正文（TXT）
                </DownloadLink>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <DownloadLink href={`/api/projects/${projectId}/export?format=json`}>
                  <FileJson className="size-4" />
                  导出项目数据（JSON）
                </DownloadLink>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={() => setReimportOpen(true)}>
            <RefreshCw className="size-4" />
            重新导入
          </Button>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        {/* 章节列表 */}
        <aside className="lg:sticky lg:top-20 lg:h-[calc(100dvh-7rem)]">
          <div className="flex h-full flex-col rounded-lg border bg-card">
            <div className="border-b px-3 py-2">
              <h2 className="text-sm font-medium">章节列表</h2>
            </div>
            <ul
              role="list"
              aria-label="章节列表"
              onKeyDown={onListKeyDown}
              className="flex-1 overflow-y-auto p-1.5"
            >
              {chapters.map((c, i) => {
                const active = c.id === selectedId;
                return (
                  <li key={c.id}>
                    <button
                      ref={(el) => {
                        if (el) itemRefs.current.set(c.id, el);
                        else itemRefs.current.delete(c.id);
                      }}
                      type="button"
                      aria-current={active ? "true" : undefined}
                      onClick={() => setSelectedId(c.id)}
                      className={cn(
                        "flex w-full flex-col gap-1 rounded-md px-2.5 py-2 text-left transition-colors duration-150",
                        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        active ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                      )}
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">
                          {i + 1}
                        </span>
                        <span className="truncate text-sm font-medium">{c.rawTitle}</span>
                      </span>
                      <span className="flex items-center gap-2 pl-10">
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {c.charCount} 字
                        </span>
                        {c.flags.map((f) => (
                          <span
                            key={f}
                            className={cn(
                              "text-[11px]",
                              f === "empty" || f === "duplicate-number"
                                ? "text-destructive"
                                : "text-warning",
                            )}
                          >
                            {flagLabel(f)}
                          </span>
                        ))}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        {/* 阅读与校对 */}
        <section className="min-w-0">
          {selected ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold">{selected.rawTitle}</h2>
                  <p className="text-xs text-muted-foreground">
                    第 {selectedIndex + 1} 章 · {selected.charCount} 字
                    {selected.normalizedIndex > 0 && ` · 编号 ${selected.normalizedIndex}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label="上移章节"
                        disabled={selectedIndex === 0}
                        onClick={() => move(selectedIndex, -1)}
                      >
                        <ChevronUp className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>上移</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label="下移章节"
                        disabled={selectedIndex === chapters.length - 1}
                        onClick={() => move(selectedIndex, 1)}
                      >
                        <ChevronDown className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>下移</TooltipContent>
                  </Tooltip>
                  <Separator orientation="vertical" className="mx-1 h-6" />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label="重命名章节"
                        onClick={() => {
                          setRenameValue(selected.rawTitle);
                          setRenameTarget(selected);
                        }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>重命名</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label="从选区拆分"
                        disabled={pendingSplitOffset == null}
                        onClick={() => setSplitOpen(true)}
                      >
                        <Scissors className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {pendingSplitOffset == null ? "先在正文中选中拆分位置" : "从选区拆分"}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label="与下一章合并"
                        disabled={!nextChapter}
                        onClick={() => setMergeNext(nextChapter)}
                      >
                        <Merge className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {nextChapter ? `与「${nextChapter.rawTitle}」合并` : "已是最后一章"}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        aria-label="删除章节"
                        onClick={() => setDeleteTarget(selected)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>删除</TooltipContent>
                  </Tooltip>
                  <Separator orientation="vertical" className="mx-1 h-6" />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 font-mono text-xs"
                    aria-label="减小字号"
                    disabled={fontSize === FONT_SIZES[0]}
                    onClick={() =>
                      setFontSize((s) => FONT_SIZES[Math.max(0, FONT_SIZES.indexOf(s) - 1)])
                    }
                  >
                    A-
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 font-mono text-xs"
                    aria-label="增大字号"
                    disabled={fontSize === FONT_SIZES[FONT_SIZES.length - 1]}
                    onClick={() =>
                      setFontSize((s) =>
                        FONT_SIZES[Math.min(FONT_SIZES.length - 1, FONT_SIZES.indexOf(s) + 1)],
                      )
                    }
                  >
                    A+
                  </Button>
                </div>
              </div>

              {selected.flags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {selected.flags.map((f) => (
                    <Badge key={f} variant="outline" className={cn("text-xs", FLAG_TONE[f])}>
                      <AlertTriangle className="size-3" aria-hidden />
                      {flagLabel(f)}
                    </Badge>
                  ))}
                </div>
              )}

              <Alert>
                <AlertDescription className="text-xs">
                  原文只读，校对操作仅调整切分与标题，不改动文字内容。选中正文片段后可点击剪刀图标拆分。
                </AlertDescription>
              </Alert>

              <Card>
                <CardContent className="p-0">
                  <div className="max-h-[calc(100dvh-22rem)] min-h-64 overflow-y-auto px-6 py-6">
                    {loadingContent && selectedContent === undefined ? (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        加载正文…
                      </p>
                    ) : selectedFailed && selectedContent === undefined ? (
                      <div className="flex flex-col items-start gap-2 py-6 text-sm text-muted-foreground">
                        <p>正文加载失败。</p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => selected && retryContent(selected.id)}
                        >
                          <RefreshCw className="size-4" />
                          重试
                        </Button>
                      </div>
                    ) : (
                      <div
                        ref={readerRef}
                        role="region"
                        aria-label={`${selected.rawTitle} 正文（只读）`}
                        tabIndex={0}
                        onMouseUp={captureSelection}
                        onKeyUp={captureSelection}
                        className="reading-surface max-w-[42rem] cursor-text rounded-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        style={{ fontSize }}
                      >
                        {selectedContent ?? ""}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
                <BookOpen className="size-8 text-muted-foreground" aria-hidden />
                <p className="text-sm text-muted-foreground">从左侧选择一章查看正文</p>
              </CardContent>
            </Card>
          )}
        </section>
      </div>

      <Dialog open={Boolean(renameTarget)} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名章节</DialogTitle>
            <DialogDescription>仅修改标题，不影响正文。</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="ch-title">章节标题</Label>
            <Input
              id="ch-title"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameTarget(null)} disabled={busy}>
              取消
            </Button>
            <Button onClick={saveRename} disabled={busy}>
              {busy ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={splitOpen}
        onOpenChange={(o) => {
          setSplitOpen(o);
          if (!o) setPendingSplitOffset(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>从选区拆分？</AlertDialogTitle>
            <AlertDialogDescription>
              将在选中位置把「{selected?.rawTitle}」拆成两章，原文内容不变。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {(headPreview || tailPreview) && (
            <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
              <p className="truncate text-muted-foreground">…{headPreview}</p>
              <Separator />
              <p className="truncate">{tailPreview}…</p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void doSplit();
              }}
            >
              {busy ? "拆分中…" : "拆分"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(mergeNext)} onOpenChange={(o) => !o && setMergeNext(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>合并章节？</AlertDialogTitle>
            <AlertDialogDescription>
              「{mergeNext?.rawTitle}」的正文将并入「{selected?.rawTitle}」，并从列表中移除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void doMerge();
              }}
            >
              {busy ? "合并中…" : "合并"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除章节？</AlertDialogTitle>
            <AlertDialogDescription>
              将从项目中删除「{deleteTarget?.rawTitle}」及其正文，无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void doDelete();
              }}
            >
              {busy ? "删除中…" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={reimportOpen} onOpenChange={setReimportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>重新导入原文</DialogTitle>
            <DialogDescription>
              重新导入会替换当前章节，并清除基于旧原文的分析、记忆、续写方向、草稿、连续性问题和提案。请先导出需要保留的项目数据；有分析任务运行时需先取消或等待完成。
            </DialogDescription>
          </DialogHeader>
          <ImportPanel
            projectId={projectId}
            compact
            onImported={async () => {
              await refreshList();
              setReimportOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
