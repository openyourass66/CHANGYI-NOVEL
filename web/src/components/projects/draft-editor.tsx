"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { notify } from "@/components/operation-prompt";
import {
  Check,
  Download,
  ExternalLink,
  Loader2,
  Pencil,
  RotateCcw,
  Save,
  ScanSearch,
  ScrollText,
  Sparkles,
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
import { ISSUE_SEVERITY, ISSUE_STATUS, toneClass } from "@/lib/domain";
import { cn } from "@/lib/utils";
import {
  ISSUE_CATEGORY_TONE,
  ISSUE_SEVERITY_TONE,
  ISSUE_STATUS_TONE,
  MEMORY_UPDATE_LABEL,
  MEMORY_UPDATE_TONE,
  type ContinuityIssueView,
  type DraftChapterView,
} from "@/lib/continuation-view";
import type { IssueStatus } from "@/lib/domain";

/** 一处正文高亮：由问题证据的偏移合并而来（重叠区间合并，行内只渲染一段）。 */
type MarkSpan = { start: number; end: number; issueIds: string[]; open: boolean };

/** 把各问题的草稿证据偏移合并成互不重叠的高亮区间。 */
function mergeMarks(issues: ContinuityIssueView[], draftId: string): MarkSpan[] {
  const raw: { start: number; end: number; issueId: string; open: boolean }[] = [];
  for (const issue of issues) {
    for (const ev of issue.evidence) {
      if (
        ev.kind === "draft" &&
        ev.draftId === draftId &&
        typeof ev.startOffset === "number" &&
        typeof ev.endOffset === "number" &&
        ev.endOffset > ev.startOffset
      ) {
        raw.push({
          start: ev.startOffset,
          end: ev.endOffset,
          issueId: issue.id,
          open: issue.status === "open",
        });
      }
    }
  }
  raw.sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: MarkSpan[] = [];
  for (const span of raw) {
    const last = merged[merged.length - 1];
    if (last && span.start < last.end) {
      last.end = Math.max(last.end, span.end);
      last.open = last.open || span.open;
      if (!last.issueIds.includes(span.issueId)) last.issueIds.push(span.issueId);
    } else {
      merged.push({ start: span.start, end: span.end, issueIds: [span.issueId], open: span.open });
    }
  }
  return merged;
}

/** 按空行/换行切段，同时记录每段在全文中的起始偏移，便于把绝对偏移映射到段内。 */
function toParagraphs(content: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  let i = 0;
  while (i < content.length) {
    while (i < content.length && content[i] === "\n") i += 1;
    if (i >= content.length) break;
    let j = i;
    while (j < content.length && content[j] !== "\n") j += 1;
    out.push({ start: i, text: content.slice(i, j) });
    i = j;
  }
  return out;
}

/** 单章草稿的阅读 / 编辑对话框。保存走 PATCH，正文一改即 version+1。 */
export function DraftEditor({
  draft,
  open,
  regenerating,
  issues,
  checking,
  proposing,
  onOpenChange,
  onSaved,
  onDeleted,
  onRegenerate,
  onCheck,
  onProposeMemory,
  onIssueStatus,
  onExportText,
}: {
  draft: DraftChapterView;
  open: boolean;
  regenerating: boolean;
  issues: ContinuityIssueView[];
  checking: boolean;
  proposing: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (draft: DraftChapterView) => void;
  onDeleted: (id: string) => void;
  onRegenerate: () => void;
  onCheck: () => void;
  onProposeMemory: () => void;
  onIssueStatus: (issueId: string, status: IssueStatus) => void;
  onExportText?: (fileName: string, text: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [title, setTitle] = useState(draft.title ?? "");
  const [content, setContent] = useState(draft.content);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const dirty = title !== (draft.title ?? "") || content !== draft.content;
  const marks = useMemo(() => mergeMarks(issues, draft.id), [issues, draft.id]);
  const openCount = issues.filter((i) => i.status === "open").length;

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
      notify.success(`已保存（v${saved.version}）`);
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

  /** 点击问题里的草稿证据：滚动到对应高亮并短暂闪烁。 */
  function jumpTo(issueId: string) {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-issue-ids~="${issueId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashId(issueId);
    window.setTimeout(() => setFlashId((cur) => (cur === issueId ? null : cur)), 1400);
  }

  /** 把一段落按高亮区间切成普通文本与 <mark>。 */
  function renderParagraph(p: { start: number; text: string }): ReactNode {
    const rel = marks
      .filter((m) => m.start < p.start + p.text.length && m.end > p.start)
      .map((m) => ({
        start: Math.max(m.start, p.start) - p.start,
        end: Math.min(m.end, p.start + p.text.length) - p.start,
        issueIds: m.issueIds,
        open: m.open,
      }))
      .sort((a, b) => a.start - b.start);

    if (rel.length === 0) return p.text;

    const out: ReactNode[] = [];
    let pos = 0;
    rel.forEach((m, k) => {
      if (m.start > pos) out.push(p.text.slice(pos, m.start));
      const flashing = flashId !== null && m.issueIds.includes(flashId);
      out.push(
        <mark
          key={k}
          data-issue-ids={m.issueIds.join(" ")}
          className={cn(
            "rounded-sm px-0.5",
            flashing
              ? "animate-pulse bg-warning/50"
              : m.open
                ? "bg-warning/25"
                : "bg-muted text-muted-foreground",
          )}
        >
          {p.text.slice(m.start, m.end)}
        </mark>,
      );
      pos = Math.max(pos, m.end);
    });
    if (pos < p.text.length) out.push(p.text.slice(pos));
    return out;
  }

  const busy = saving || deleting || regenerating;
  const paragraphs = toParagraphs(content);

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
            <Badge variant="outline" className="text-xs font-normal">
              {MEMORY_UPDATE_LABEL[draft.memoryUpdateStatus]}
            </Badge>
            {dirty && (
              <Badge variant="outline" className="text-xs text-warning">
                有未保存的修改
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            这是续写草稿，只存在于续写区；原文与记忆不会被它改动。
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

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          {mode === "read" ? (
            <>
              <div>
                <h2 className="mb-3 text-lg font-semibold">{title || "（无标题）"}</h2>
                <div className="reading-surface space-y-3 text-[15px]">
                  {paragraphs.map((p, i) => (
                    <p key={i}>{renderParagraph(p)}</p>
                  ))}
                </div>
              </div>

              <section className="rounded-md border">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
                  <div className="flex items-center gap-2">
                    <ScanSearch className="size-4 text-muted-foreground" aria-hidden />
                    <span className="text-sm font-medium">连续性待核对</span>
                    {openCount > 0 && (
                      <Badge variant="outline" className={toneClass("warning")}>
                        {openCount} 处待处理
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onCheck}
                    disabled={busy || checking}
                  >
                    {checking ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ScanSearch className="size-4" />
                    )}
                    {draft.continuityCheckedAt ? "重新检查" : "检查连续性"}
                  </Button>
                </div>

                <div className="space-y-2 p-3">
                  {issues.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {draft.continuityCheckedAt
                        ? "上次检查未发现明确冲突。"
                        : "尚未检查。检查会对照记忆与原文，标出可疑之处。"}
                      这里只给线索，不作结论。
                    </p>
                  ) : (
                    issues.map((issue) => (
                      <article
                        key={issue.id}
                        className={cn(
                          "space-y-2 rounded-md border p-3",
                          issue.status !== "open" && "opacity-60",
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant="outline"
                            className={toneClass(ISSUE_SEVERITY_TONE[issue.severity])}
                          >
                            {ISSUE_SEVERITY[issue.severity]}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={toneClass(ISSUE_CATEGORY_TONE[issue.category] ?? "muted")}
                          >
                            {issue.category}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={toneClass(ISSUE_STATUS_TONE[issue.status])}
                          >
                            {ISSUE_STATUS[issue.status]}
                          </Badge>
                          <div className="ml-auto flex gap-1">
                            {issue.status === "open" ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => onIssueStatus(issue.id, "resolved")}
                                >
                                  标记已解决
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => onIssueStatus(issue.id, "ignored")}
                                >
                                  忽略
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onIssueStatus(issue.id, "open")}
                              >
                                重新打开
                              </Button>
                            )}
                          </div>
                        </div>
                        <p className="text-sm">{issue.description}</p>
                        {issue.evidence.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {issue.evidence.map((ev, i) => {
                              if (ev.kind === "memory" && ev.entryId) {
                                return (
                                  <Link
                                    key={i}
                                    href={`/projects/${draft.projectId}/memory?entry=${ev.entryId}`}
                                    className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                                  >
                                    <ExternalLink className="size-3" aria-hidden />
                                    相关记忆
                                  </Link>
                                );
                              }
                              if (ev.kind === "draft" && ev.excerpt) {
                                const jumpable =
                                  typeof ev.startOffset === "number" &&
                                  typeof ev.endOffset === "number";
                                return (
                                  <button
                                    key={i}
                                    type="button"
                                    disabled={!jumpable}
                                    onClick={() => jumpable && jumpTo(issue.id)}
                                    title={ev.excerpt}
                                    className={cn(
                                      "max-w-[22rem] truncate rounded-md border px-2 py-0.5 text-left text-xs",
                                      jumpable
                                        ? "text-foreground hover:bg-muted"
                                        : "text-muted-foreground",
                                    )}
                                  >
                                    「{ev.excerpt}」
                                  </button>
                                );
                              }
                              return null;
                            })}
                          </div>
                        )}
                      </article>
                    ))
                  )}
                </div>
              </section>

              <section className="rounded-md border">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-muted-foreground" aria-hidden />
                    <span className="text-sm font-medium">记忆增量</span>
                    <Badge
                      variant="outline"
                      className={toneClass(MEMORY_UPDATE_TONE[draft.memoryUpdateStatus])}
                    >
                      {MEMORY_UPDATE_LABEL[draft.memoryUpdateStatus]}
                    </Badge>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onProposeMemory}
                    disabled={busy || proposing}
                  >
                    {proposing ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    提取记忆变化
                  </Button>
                </div>
                <p className="px-3 py-3 text-sm text-muted-foreground">
                  从本章草稿里提取相对既有记忆的新变化（新事件、人物状态、悬念进展），生成待确认的提案；到「分析」页采纳后才会写入记忆，原文始终不变。
                </p>
              </section>
            </>
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

        {mode === "read" && draft.outlineItem && (
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Check className="size-3.5" aria-hidden />
              所依据的章纲 · 第 {draft.outlineItem.index} 章 · {draft.outlineItem.title}
            </p>
            <p className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground">
              {draft.outlineItem.summary}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
