"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "@/components/operation-prompt";
import { Download, MapPin, Plus, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MEMORY_CATEGORY,
  MEMORY_STATUS,
  MEMORY_STATUS_TONE,
  toneClass,
  type MemoryCategory,
} from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { KeyConflict, KnowledgeView, MemoryEntryView } from "@/lib/memory-view";
import { MemoryEditor, type ChapterOption } from "@/components/projects/memory-editor";
import { MemoryImportDialog } from "@/components/projects/memory-import-dialog";
import { KnowledgePanel } from "@/components/projects/knowledge-panel";
import { PageFrame, ScrollRegion, SearchField } from "@/components/page-frame";

type MemoryListResponse = {
  entries: MemoryEntryView[];
  counts: Record<string, number>;
  conflicts: KeyConflict[];
  error?: string;
};

const ALL = "all" as const;
type CategoryFilter = MemoryCategory | typeof ALL;

const dateFmt = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const CATEGORIES = Object.keys(MEMORY_CATEGORY) as MemoryCategory[];

export function MemoryWorkbench({
  projectId,
  projectName,
  initialEntries,
  initialCounts,
  initialConflicts,
  initialKnowledge,
  chapters,
  focusEntryId = null,
}: {
  projectId: string;
  projectName: string;
  initialEntries: MemoryEntryView[];
  initialCounts: Record<string, number>;
  initialConflicts: KeyConflict[];
  initialKnowledge: KnowledgeView[];
  chapters: ChapterOption[];
  /** 由 ?entry= 传入时，进入页面后滚动到该条目并短暂高亮。 */
  focusEntryId?: string | null;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [counts, setCounts] = useState(initialCounts);
  const [conflicts, setConflicts] = useState(initialConflicts);
  const [category, setCategory] = useState<CategoryFilter>(ALL);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"entries" | "knowledge" | "conflicts">("entries");
  const [loading, setLoading] = useState(false);
  const [flashEntryId, setFlashEntryId] = useState<string | null>(focusEntryId);
  const [editor, setEditor] = useState<{
    entry: MemoryEntryView | null;
    category: MemoryCategory;
  } | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const requestSequence = useRef(0);
  const [viewKey, setViewKey] = useState(`${ALL}:`);

  useEffect(() => () => { requestSequence.current += 1; if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // 由连续性检查的问题「相关记忆」跳转进来时，把目标条目滚到视野中央并高亮一下。
  useEffect(() => {
    if (!focusEntryId) return;
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-entry-id="${focusEntryId}"]`);
    const region = el?.closest<HTMLElement>(".workspace-scroll");
    if (el && region) region.scrollTop += el.getBoundingClientRect().top - region.getBoundingClientRect().top - (region.clientHeight - el.clientHeight) / 2;
    const timer = window.setTimeout(() => setFlashEntryId(null), 2000);
    return () => window.clearTimeout(timer);
  }, [focusEntryId]);

  const load = useCallback(
    async (nextCategory: CategoryFilter, nextQuery: string) => {
      const sequence = ++requestSequence.current;
      setLoading(true);
      try {
        const p = new URLSearchParams();
        if (nextCategory !== ALL) p.set("category", nextCategory);
        if (nextQuery.trim()) p.set("q", nextQuery.trim());
        const res = await fetch(`/api/projects/${projectId}/memory?${p.toString()}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as MemoryListResponse;
        if (!res.ok) throw new Error(data.error ?? "加载失败");
        if (sequence !== requestSequence.current) return;
        setViewKey(`${nextCategory}:${nextQuery}`);
        setEntries(data.entries);
        setCounts(data.counts);
        setConflicts(data.conflicts);
      } catch (err) {
        if (sequence === requestSequence.current) notify.error(err instanceof Error ? err.message : "加载失败");
      } finally {
        if (sequence === requestSequence.current) setLoading(false);
      }
    },
    [projectId],
  );

  function selectCategory(next: CategoryFilter) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setCategory(next);
    void load(next, query);
  }

  function onQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void load(category, value), 300);
  }

  function openCreate() {
    setEditor({ entry: null, category: category === ALL ? CATEGORIES[0] : category });
  }

  function openEdit(entry: MemoryEntryView) {
    setEditor({ entry, category: entry.category });
  }

  function afterMutate() {
    setEditor(null);
    void load(category, query);
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const currentCount = category === ALL ? total : (counts[category] ?? 0);

  return (
    <PageFrame projectId={projectId} title={projectName} section="记忆工作台" description="记忆工作台 · 汇集人物、设定与故事线索，出处可回溯到原文。" actions={<>
          <MemoryImportDialog
            projectId={projectId}
            onImported={() => {
              void load(category, query);
            }}
          />
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/projects/${projectId}/memory/export`}>
              <Download className="size-4" aria-hidden />
              导出记忆（Markdown）
            </a>
          </Button></>}>
      <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="memory-tabs">
        <div className="page-toolbar">
          <SearchField label="搜索记忆条目" value={query} onChange={onQueryChange} />
        <TabsList>
          <TabsTrigger value="entries">记忆条目 {total}</TabsTrigger>
          <TabsTrigger value="knowledge">人物认知 {initialKnowledge.length}</TabsTrigger>
          <TabsTrigger value="conflicts">
            冲突审阅
            {conflicts.length > 0 && (
              <Badge variant="outline" className={cn("ml-1", toneClass("warning"))}>
                {conflicts.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
          {tab === "entries" && <Button className="toolbar-end" onClick={openCreate}><Plus className="size-4" />新建条目</Button>}
        </div>

        <TabsContent value="entries">
          <div className="workspace-split">
            <aside className="workspace-sidebar" aria-label="记忆分类"><h2 className="workspace-sidebar-heading">记忆分类</h2>
              <div className="space-y-1">
                <CategoryButton
                  active={category === ALL}
                  label="全部"
                  count={total}
                  onClick={() => selectCategory(ALL)}
                />
                {CATEGORIES.map((c) => (
                  <CategoryButton
                    key={c}
                    active={category === c}
                    label={MEMORY_CATEGORY[c]}
                    count={counts[c] ?? 0}
                    onClick={() => selectCategory(c)}
                  />
                ))}
              </div>
            </aside>

            <section className="workspace-panel" aria-busy={loading}>
              <div className="workspace-panel-heading"><h2>{category === ALL ? "全部记忆" : MEMORY_CATEGORY[category]}</h2><small role="status">{loading ? "加载中…" : `共 ${currentCount} 条`}</small></div>
              <ScrollRegion label="记忆条目列表" positionKey={`memory:${projectId}:${viewKey}`}>
              <div aria-live="polite">
              {entries.length === 0 && (
                <div className="rounded-lg border border-dashed p-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    {query.trim() ? "没有匹配的记忆条目。" : "该分类下暂无记忆条目。"}
                  </p>
                  <Button variant="outline" className="mt-4" onClick={openCreate}>
                    <Plus className="size-4" />
                    新建条目
                  </Button>
                </div>
              )}
              {entries.length > 0 && (
                <>
                  <ul role="list" className="memory-list">
                    {entries.map((e) => (
                      <li key={e.id} data-entry-id={e.id}>
                        <button
                          type="button"
                          onClick={() => openEdit(e)}
                          className={cn(
                            "w-full rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                            flashEntryId === e.id && "ring-2 ring-warning",
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">
                                  {e.title || e.key || "（无标题）"}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={toneClass(MEMORY_STATUS_TONE[e.status] ?? "muted")}
                                >
                                  {MEMORY_STATUS[e.status]}
                                </Badge>
                                <Badge variant="secondary" className="text-xs">
                                  {MEMORY_CATEGORY[e.category]}
                                </Badge>
                                {e.revision > 1 && (
                                  <span className="font-mono text-xs text-muted-foreground">
                                    v{e.revision}
                                  </span>
                                )}
                              </div>
                              <p className="line-clamp-2 text-sm text-muted-foreground">
                                {e.content}
                              </p>
                              {e.citations.length > 0 && (
                                <p className="flex flex-wrap items-center gap-1 pt-1">
                                  {e.citations.map((c, i) => (
                                    <span
                                      key={i}
                                      className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs text-muted-foreground"
                                    >
                                      <MapPin className="size-3" aria-hidden />第 {c.chapterIndex} 章
                                    </span>
                                  ))}
                                </p>
                              )}
                            </div>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {dateFmt.format(new Date(e.updatedAt))}
                            </span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              </div></ScrollRegion>
              <div className="workspace-panel-footer"><span>点击条目查看与编辑，关闭后保留当前位置</span><button onClick={() => rootRef.current?.querySelector('[aria-label="记忆条目列表"]')?.scrollTo({ top: 0, behavior: "instant" })}>回到顶部 ↑</button></div>
            </section>
          </div>
        </TabsContent>

        <TabsContent value="knowledge"><ScrollRegion label="人物认知列表" className="rounded-lg border bg-card p-5" positionKey={`knowledge:${projectId}`}>
          <KnowledgePanel key={initialKnowledge.map((item) => `${item.id}:${item.relation}:${item.infoItem}`).join(";")} projectId={projectId} initialKnowledge={initialKnowledge} />
        </ScrollRegion></TabsContent>

        <TabsContent value="conflicts"><ScrollRegion label="冲突审阅列表" className="space-y-3 rounded-lg border bg-card p-5" positionKey={`conflicts:${projectId}`}>
          {conflicts.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <p className="text-sm text-muted-foreground">
                未发现键冲突。同一分类下「当前」条目共用同一键时会在此提示审阅。
              </p>
            </div>
          ) : (
            conflicts.map((group) => (
              <div key={`${group.category}::${group.key}`} className="rounded-lg border bg-card p-4">
                <h3 className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <TriangleAlert className="size-4 text-warning" aria-hidden />
                  <Badge variant="secondary" className="text-xs">
                    {MEMORY_CATEGORY[group.category]}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">{group.key}</span>
                  <span className="text-xs text-muted-foreground">
                    {group.entries.length} 条并存
                  </span>
                </h3>
                <ul role="list" className="mt-3 space-y-2">
                  {group.entries.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => openEdit(e)}
                        className="w-full rounded-md border p-3 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{e.title || "（无标题）"}</span>
                          <Badge
                            variant="outline"
                            className={toneClass(MEMORY_STATUS_TONE[e.status] ?? "muted")}
                          >
                            {MEMORY_STATUS[e.status]}
                          </Badge>
                          <span className="font-mono text-xs text-muted-foreground">
                            v{e.revision}
                          </span>
                        </p>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{e.content}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </ScrollRegion></TabsContent>
      </Tabs>

      {editor && (
        <MemoryEditor
          projectId={projectId}
          chapters={chapters}
          entry={editor.entry}
          defaultCategory={editor.category}
          onClose={() => setEditor(null)}
          onSaved={afterMutate}
          onDeleted={afterMutate}
        />
      )}
      </div>
    </PageFrame>
  );
}

function CategoryButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        active
          ? "bg-accent font-medium text-accent-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <span className="truncate">{label}</span>
      <span className="shrink-0 font-mono text-xs tabular-nums">{count}</span>
    </button>
  );
}
