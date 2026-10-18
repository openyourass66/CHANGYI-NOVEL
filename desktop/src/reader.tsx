import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLoaderData, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { BookOpen, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectNav } from "@/components/projects/project-nav";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "./bridge";
import { useWorkflows } from "./automation";
import { generationTime, type Work, type WorkChapter } from "./works";
import type { ContinuationPlanView, DraftChapterView } from "@/lib/continuation-view";

type Data = { project: { id: string; name: string }; plans: ContinuationPlanView[] };
type Preferences = { size: number; line: number; width: number; theme: string };
function stored<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; } }
export function Reader() {
  const data = useLoaderData() as Data & { work?: Work };
  const work = data.work;
  const project = work ? { id: work.id, name: work.title } : data.project;
  const plans = data.plans ?? [];

  const [search, setSearch] = useSearchParams();
  const progressKey = `${work ? "native-work-reader" : "native-reader"}:${project.id}`;
  const saved = useMemo(() => stored(progressKey, { plan: "", chapter: "" }), [progressKey]);
  const planId = work?.id ?? search.get("plan") ?? (plans.some((p) => p.id === saved.plan) ? saved.plan : plans.find((p) => p.status === "active")?.id ?? plans[0]?.id ?? "");
  useEffect(() => { setChapterId(saved.chapter); }, [project.id]);
  const [drafts, setDrafts] = useState<WorkChapter[]>([]);
  const [chapterId, setChapterId] = useState(saved.chapter);
  const [preferences, setPreferences] = useState<Preferences>(() => stored("native-reader-preferences", { size: 20, line: 1.9, width: 760, theme: "system" }));
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false); const [text, setText] = useState(""); const [title, setTitle] = useState(""); const [saving, setSaving] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const workflows = useWorkflows();
  const running = !work && workflows.some((w) => w.projectId === project.id && w.status === "running");
  const index = Math.max(0, drafts.findIndex((d) => d.id === chapterId));
  const chapter = drafts[index];
  const positionKey = `${progressKey}:${planId}:${chapter?.id ?? ""}`;
  useEffect(() => { localStorage.setItem("native-reader-preferences", JSON.stringify(preferences)); }, [preferences]);
  useEffect(() => {
    if (work) { setDrafts(work.chapters); setLoading(false); setEditing(false); return; }
    if (!planId) return;
    let active = true; let timer: ReturnType<typeof setTimeout>;
    setLoading(true); setDrafts([]); setEditing(false);
    async function load() {
      try { const data = await api<{drafts: DraftChapterView[]}>(`/api/projects/${project.id}/plans/${planId}/drafts`); if (active) { setDrafts(data.drafts); setError(""); } }
      catch (e) { if (active) setError(String(e)); }
      finally { if (active) { setLoading(false); if (running) timer = setTimeout(() => void load(), 2500); } }
    }
    void load(); return () => { active = false; clearTimeout(timer); };
  }, [project.id, planId, running, work]);
  useEffect(() => {
    if (!chapter) return;
    localStorage.setItem(progressKey, JSON.stringify({ plan: planId, chapter: chapter.id }));
    const frame = requestAnimationFrame(() => { if (viewport.current) viewport.current.scrollTop = Math.max(0, Number(localStorage.getItem(positionKey)) || 0); });
    return () => cancelAnimationFrame(frame);
  }, [chapter?.id, positionKey, planId, progressKey]);
  function choose(id: string) { setChapterId(id); setEditing(false); }
  async function save() {
    if (!chapter) return; setSaving(true);
    try { const { draft } = await api<{draft: DraftChapterView}>(`/api/projects/${project.id}/drafts/${chapter.id}`, "PATCH", { title, content: text, expectedVersion: chapter.version }); setDrafts((rows) => rows.map((r) => r.id === draft.id ? draft : r)); setEditing(false); setError(""); }
    catch (e) { setError(String(e)); } finally { setSaving(false); }
  }
  async function exportText() {
    try { await invoke("save_text", { fileName: `${project.name}-续写.txt`, text: drafts.map((d) => `第${d.index}章 ${d.title ?? ""}\n\n${d.content}`).join("\n\n") }); }
    catch (e) { setError(String(e)); }
  }
  return <div className="mx-auto w-full max-w-7xl space-y-5 p-6">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="flex items-center gap-2 text-2xl font-semibold"><BookOpen className="size-6" />{project.name}</h1><p className="mt-1 text-sm text-muted-foreground">{work ? `生成时间：${generationTime(work.generatedAt)}` : "续写阅读 · 阅读位置自动保存"}</p></div>{work ? <Button asChild variant="outline"><Link to="/works">返回作品库</Link></Button> : <ProjectNav projectId={project.id} />}</header>
    <div className="reader-layout" data-reading-theme={preferences.theme}>
      <aside className="reader-directory space-y-4 border-r p-4">
        {work ? <div className="space-y-2"><h2 className="text-sm font-semibold">{work.direction}</h2><p className="text-xs opacity-70">来源：{work.sourceProjectName}</p></div> : <label className="block space-y-2 text-sm font-medium">续写方向<select className="reader-select w-full" value={planId} onChange={(e) => { setSearch({plan:e.target.value}); setChapterId(""); }}><option value="" disabled>选择续写方向</option>{plans.map((p) => <option value={p.id} key={p.id}>{p.direction}</option>)}</select></label>}
        <h2 className="text-sm font-medium">目录 · {drafts.length} 章{running ? " · 正在生成" : ""}</h2>
        <nav aria-label="续写章节目录" className="space-y-1">{drafts.map((d) => <button key={d.id} aria-current={d.id === chapter?.id ? "page" : undefined} className="reader-chapter w-full rounded-md px-3 py-3 text-left text-sm" onClick={() => choose(d.id)}>第 {d.index} 章 · {d.title || "无标题"}</button>)}</nav>
        <Button variant="outline" disabled={!drafts.length} onClick={() => void exportText()}>导出全文</Button>
      </aside>
      <section className="min-w-0">
        <div className="reader-toolbar flex flex-wrap items-center gap-4 border-b px-5 py-3 text-sm">
          <label>字号 <input aria-label="阅读字号" type="range" min="16" max="32" value={preferences.size} onChange={(e) => setPreferences({...preferences,size:Number(e.target.value)})} className="w-20 align-middle" /> {preferences.size}</label>
          <label>行距 <select aria-label="阅读行距" value={preferences.line} onChange={(e) => setPreferences({...preferences,line:Number(e.target.value)})} className="reader-select"><option value="1.6">紧凑</option><option value="1.9">舒适</option><option value="2.2">宽松</option></select></label>
          <label>宽度 <select aria-label="阅读宽度" value={preferences.width} onChange={(e) => setPreferences({...preferences,width:Number(e.target.value)})} className="reader-select"><option value="600">窄</option><option value="760">适中</option><option value="920">宽</option></select></label>
          <label>背景 <select aria-label="阅读背景" value={preferences.theme} onChange={(e) => setPreferences({...preferences,theme:e.target.value})} className="reader-select"><option value="system">跟随应用</option><option value="light">浅色</option><option value="sepia">护眼</option><option value="dark">深色</option></select></label>
        </div>
        {error && <p role="alert" className="px-6 py-3 text-sm text-destructive">{error}</p>}
        <div ref={viewport} tabIndex={0} aria-label="小说正文" className="reader-viewport" onScroll={(e) => { if (chapter) localStorage.setItem(positionKey, String(e.currentTarget.scrollTop)); }}>
          {!chapter ? <div className="px-8 py-20 text-center"><h2 className="text-xl font-medium">{loading ? "正在加载正文…" : "还没有可阅读的续写章节"}</h2><p className="mt-3 text-sm">{running ? "生成的章节会自动出现在这里。" : "选定续写方向并开始生成后，即可在这里连续阅读。"}</p><Button asChild className="mt-6"><Link to={`/projects/${project.id}/continuation`}>前往续写规划</Link></Button></div> : <article className="mx-auto px-6 py-10 sm:px-10" style={{ maxWidth: preferences.width, fontSize: preferences.size, lineHeight: preferences.line }}>
            <p className="mb-3 text-sm opacity-65">第 {chapter.index} 章 · {chapter.content.length.toLocaleString()} 字</p>
            <h2 className="mb-8 text-2xl font-semibold">{chapter.title || "无标题"}</h2>
            {editing ? <div className="space-y-4"><label className="block text-sm">章节标题<Input value={title} onChange={(e) => setTitle(e.target.value)} /></label><label className="block text-sm">章节正文<Textarea className="mt-2 min-h-96 text-base" value={text} onChange={(e) => setText(e.target.value)} /></label><div className="flex gap-3"><Button disabled={saving || !text.trim()} onClick={() => void save()}>{saving ? "保存中…" : "保存修改"}</Button><Button variant="outline" disabled={saving} onClick={() => setEditing(false)}>取消编辑</Button></div></div> : <div className="reader-prose">{chapter.content.split(/\n+/).filter(Boolean).map((paragraph,i) => <p key={i}>{paragraph}</p>)}</div>}
            <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t pt-6 text-sm"><Button variant="ghost" disabled={index === 0 || editing} onClick={() => choose(drafts[index-1].id)}><ChevronLeft className="size-4" />上一章</Button><span>{index+1} / {drafts.length}</span><Button variant="ghost" disabled={index >= drafts.length-1 || editing} onClick={() => choose(drafts[index+1].id)}>下一章<ChevronRight className="size-4" /></Button></footer>
            {!work && <div className="mt-6 flex justify-center gap-3"><Button variant="outline" disabled={running || editing} onClick={() => { setText(chapter.content); setTitle(chapter.title ?? ""); setEditing(true); }}>编辑本章</Button><Button variant="ghost" asChild><Link to={`/projects/${project.id}/continuation`}>查看检查问题</Link></Button></div>}
          </article>}
        </div>
      </section>
    </div>
  </div>;
}
