import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLoaderData } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { BookOpen, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generationTime, type Work } from "./works";
import { MergeWorkButton } from "./merge-work-button";

type Preferences = { size: number; line: number; width: number; theme: string };
function stored<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; }
  catch { return fallback; }
}
export function Reader() {
  const { work } = useLoaderData() as { work: Work };
  return <WorkReader key={work.id} work={work} />;
}
function WorkReader({ work }: { work: Work }) {
  const progressKey = `native-work-reader:${work.id}`;
  const [chapterId, setChapterId] = useState(() => stored(progressKey, { chapter: "" }).chapter);
  const [preferences, setPreferences] = useState<Preferences>(() => stored("native-reader-preferences", { size: 20, line: 1.9, width: 760, theme: "system" }));
  const [error, setError] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const chapters = work.chapters;
  const index = Math.max(0, chapters.findIndex((item) => item.id === chapterId));
  const chapter = chapters[index];
  const positionKey = `${progressKey}:${work.id}:${chapter?.id ?? ""}`;
  function openChapter(id: string) {
    localStorage.setItem(`${progressKey}:${work.id}:${id}`, "0");
    viewport.current?.focus({ preventScroll: true });
    if (id === chapter?.id && viewport.current) viewport.current.scrollTop = 0;
    setChapterId(id);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  useEffect(() => { localStorage.setItem("native-reader-preferences", JSON.stringify(preferences)); }, [preferences]);
  useLayoutEffect(() => {
    if (!chapter) return;
    localStorage.setItem(progressKey, JSON.stringify({ chapter: chapter.id }));
    if (viewport.current) viewport.current.scrollTop = Math.max(0, Number(localStorage.getItem(positionKey)) || 0);
  }, [chapter?.id, positionKey, progressKey]);
  async function exportText() {
    try {
      await invoke("save_text", { fileName: `${work.title}.txt`, text: chapters.map((item) => `第${item.index}章 ${item.title ?? ""}\n\n${item.content}`).join("\n\n") });
      setError("");
    } catch (e) { setError(String(e)); }
  }
  return <div className="mx-auto w-full max-w-7xl space-y-5 p-6">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="flex items-center gap-2 text-2xl font-semibold"><BookOpen className="size-6" />{work.title}</h1><p className="mt-1 text-sm text-muted-foreground">生成时间：{generationTime(work.generatedAt)}</p></div>
      <div className="flex flex-wrap items-center gap-2"><MergeWorkButton work={work} /><Button asChild variant="outline"><Link to="/works">返回作品库</Link></Button></div>
    </header>
    <div className="reader-layout" data-reading-theme={preferences.theme}>
      <aside className="reader-directory space-y-4 border-r p-4">
        <div className="space-y-2"><h2 className="text-sm font-semibold">{work.direction}</h2><p className="text-xs opacity-70">来源：{work.sourceProjectName}</p></div>
        <h2 className="text-sm font-medium">目录 · {chapters.length} 章</h2>
        <nav aria-label="续写章节目录" className="space-y-1">{chapters.map((item) => <button key={item.id} aria-current={item.id === chapter?.id ? "page" : undefined} className="reader-chapter w-full rounded-md px-3 py-3 text-left text-sm" onClick={() => openChapter(item.id)}>第 {item.index} 章 · {item.title || "无标题"}</button>)}</nav>
        <Button variant="outline" disabled={!chapters.length} onClick={() => void exportText()}>导出全文</Button>
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
          {!chapter ? <div className="px-8 py-20 text-center"><h2 className="text-xl font-medium">这部作品暂无正文</h2><Button asChild className="mt-6"><Link to="/works">返回作品库</Link></Button></div> : <article className="mx-auto px-6 py-10 sm:px-10" style={{ maxWidth: preferences.width, fontSize: preferences.size, lineHeight: preferences.line }}>
            <p className="mb-3 text-sm opacity-65">第 {chapter.index} 章 · {chapter.content.length.toLocaleString()} 字</p>
            <h2 className="mb-8 text-2xl font-semibold">{chapter.title || "无标题"}</h2>
            <div className="reader-prose">{chapter.content.split(/\n+/).filter(Boolean).map((paragraph,i) => <p key={i}>{paragraph}</p>)}</div>
            <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t pt-6 text-sm">
              <Button variant="ghost" disabled={index === 0} onClick={() => openChapter(chapters[index-1].id)}><ChevronLeft className="size-4" />上一章</Button><span>{index+1} / {chapters.length}</span><Button variant="ghost" disabled={index >= chapters.length-1} onClick={() => openChapter(chapters[index+1].id)}>下一章<ChevronRight className="size-4" /></Button>
            </footer>
          </article>}
        </div>
      </section>
    </div>
  </div>;
}
