import { PageFrame, ScrollRegion, SearchField } from "@/components/page-frame";
import { useState } from "react";
import { Link, useLoaderData } from "react-router-dom";
import { BookOpen, CalendarDays, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { api } from "./bridge";
import { MergeWorkButton } from "./merge-work-button";

export type WorkChapter = { id: string; index: number; title: string | null; content: string; version: number };
export type Work = { id: string; title: string; sourceProjectId: string | null; sourceProjectName: string; direction: string; generatedAt: string; chapterCount: number; charCount: number; chapters: WorkChapter[]; memoryCount: number; mergedAt: string | null };
const dateFormat = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Shanghai" });
export function generationTime(value: string) { return dateFormat.format(new Date(value)); }
export function WorksLibrary() {
  const data = useLoaderData() as { works: Work[] };
  const [works, setWorks] = useState(data.works);
  const [query, setQuery] = useState("");
  const visibleWorks = works.filter((work) => `${work.title} ${work.sourceProjectName} ${work.direction}`.toLowerCase().includes(query.trim().toLowerCase()));
  const [target, setTarget] = useState<Work | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function remove() {
    if (!target) return; setBusy(true);
    try { await api(`/api/works/${target.id}`, "DELETE"); setWorks((old) => old.filter((w) => w.id !== target.id)); setTarget(null); setError(""); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <PageFrame title="作品库" description={`${works.length} 部作品 · 续写完成后自动保存，随时进入阅读`} actions={<Button asChild variant="outline"><Link to="/">前往项目库</Link></Button>} toolbar={<><SearchField label="搜索作品标题" value={query} onChange={setQuery} /><span className="text-xs text-muted-foreground">全部作品 {works.length}</span></>}>
    <ScrollRegion label="作品列表" positionKey="works-library">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {works.length === 0 ? <div className="rounded-xl border border-dashed px-6 py-20 text-center"><BookOpen className="mx-auto mb-4 size-10 text-muted-foreground" /><h2 className="text-lg font-medium">还没有已完成的作品</h2><p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">在项目中选定续写方向，完成自动续写后，作品会保存在这里。</p><Button asChild className="mt-6"><Link to="/">打开项目库</Link></Button></div> : <div className="collection-grid">
      {visibleWorks.map((work) => <article key={work.id} className="overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md">
        <Link to={`/works/${work.id}`} aria-label={`阅读作品：${work.title}`} className="block rounded-t-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"><div className="work-cover"><BookOpen className="size-10 opacity-70" aria-hidden /><p className="line-clamp-2 text-center text-xl font-semibold leading-relaxed">{work.direction}</p></div><div className="space-y-3 px-5 pb-2 pt-5"><h2 className="line-clamp-2 text-base font-semibold">{work.title}</h2><p className="truncate text-sm text-muted-foreground">来源：{work.sourceProjectName}</p><p className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarDays className="size-3.5 shrink-0" />生成时间：<time dateTime={work.generatedAt}>{generationTime(work.generatedAt)}</time></p><p className="flex items-center gap-2 text-sm text-muted-foreground"><FileText className="size-4" />{work.chapterCount} 章 · {work.charCount.toLocaleString()} 字</p></div></Link>
        <div className="flex flex-wrap items-center gap-2 px-5 pb-5 pt-3"><Button asChild size="sm"><Link to={`/works/${work.id}`}>开始阅读</Link></Button><MergeWorkButton work={work} /><Button variant="ghost" size="sm" aria-label={`删除作品：${work.title}`} onClick={() => setTarget(work)}><Trash2 className="size-4" /></Button></div>
      </article>)}
    </div>}
    {works.length > 0 && visibleWorks.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">没有匹配的作品。</p>}
    </ScrollRegion>
    <AlertDialog open={Boolean(target)} onOpenChange={(open) => { if (!open && !busy) setTarget(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除这部作品？</AlertDialogTitle><AlertDialogDescription>将删除「{target?.title}」在作品库中的正文副本，原项目和草稿继续保留。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void remove(); }}>{busy ? "删除中…" : "删除作品"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </PageFrame>;
}
