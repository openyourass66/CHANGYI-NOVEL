import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider, Outlet, useLoaderData, useRevalidator, useRouteError, Link } from "react-router-dom";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, FolderOpen, LoaderCircle, KeyRound } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { OperationPromptHost, notify } from "@/components/operation-prompt";
import { ProjectLibrary } from "@/components/projects/project-library";
import { ChapterWorkspace } from "@/components/projects/chapter-workspace";
import { MemoryWorkbench } from "@/components/projects/memory-workbench";
import { AnalysisPanel } from "@/components/projects/analysis-panel";
import { ProjectNav } from "@/components/projects/project-nav";
import { ProfileManager } from "@/components/settings/profile-manager";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatLabel } from "@/lib/domain";
import type { ProjectSummary } from "@/lib/projects-view";
import type { ChapterSummary } from "@/lib/chapters-view";
import { api, installBridge } from "./bridge";
import "./styles.css";

installBridge();

type Workspace = {
  project: { id: string; name: string; genre: string | null };
  source: { fileName: string; format: string; byteSize: number; encoding: string | null; importedAt: string } | null;
  chapters: ChapterSummary[];
};

function Shell() {
  useEffect(() => {
    if (!isTauri()) return;
    document.documentElement.dataset.nativeDesktop = "true";
    const drag = (event: MouseEvent) => {
      const target = event.target;
      if (event.button !== 0 || !(target instanceof Element) || !target.closest(".app-titlebar") || target.closest("a,button,input,select,textarea,nav,[role=button]")) return;
      if (event.detail === 2) void getCurrentWindow().toggleMaximize().catch((error: unknown) => notify.error(String(error)));
      else void getCurrentWindow().startDragging().catch((error: unknown) => notify.error(String(error)));
    };
    document.addEventListener("mousedown", drag);
    return () => document.removeEventListener("mousedown", drag);
  }, []);
  return <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
    <AppShell><Outlet /></AppShell>
    <div className="native-window-controls fixed right-0 top-0 z-50 h-14 items-stretch">
      {[
        { label: "最小化", icon: Minus, action: () => getCurrentWindow().minimize() },
        { label: "最大化或还原", icon: Square, action: () => getCurrentWindow().toggleMaximize() },
        { label: "关闭", icon: X, action: () => getCurrentWindow().close() },
      ].map((item) => <button key={item.label} aria-label={item.label} className="w-12 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void item.action().catch((error: unknown) => notify.error(String(error)))}><item.icon className="mx-auto size-4" /></button>)}
    </div>
    <OperationPromptHost />
  </ThemeProvider>;
}

function Library() {
  const data = useLoaderData() as { projects: ProjectSummary[] };
  const key = data.projects.map((p) => `${p.id}:${p.updatedAt}`).join(";");
  return <ProjectLibrary key={key} projects={data.projects} />;
}

function Chapters() {
  const data = useLoaderData() as Workspace;
  const source = data.source ? { ...data.source, formatLabel: formatLabel(data.source.format) } : null;
  return <ChapterWorkspace key={`${data.project.id}:${data.source?.importedAt ?? "empty"}`} projectId={data.project.id} projectName={data.project.name} genre={data.project.genre} source={source} initialChapters={data.chapters} />;
}

type MemoryData = Workspace & {
  memory: { entries: import("@/lib/memory-view").MemoryEntryView[]; counts: Record<string, number>; conflicts: import("@/lib/memory-view").KeyConflict[] };
  knowledge: import("@/lib/memory-view").KnowledgeView[];
};

function Memory() {
  const data = useLoaderData() as MemoryData;
  return <MemoryWorkbench key={data.project.id} projectId={data.project.id} projectName={data.project.name}
    initialEntries={data.memory.entries} initialCounts={data.memory.counts} initialConflicts={data.memory.conflicts} initialKnowledge={data.knowledge}
    chapters={data.chapters.map((chapter, i) => ({ id: chapter.id, index: i + 1, title: chapter.rawTitle }))}
    focusEntryId={new URLSearchParams(location.hash.split("?")[1] ?? "").get("entry")} />;
}

type AnalysisData = Workspace & {
  profiles: import("@/lib/ai/profiles").ProfileView[];
  proposals: import("@/lib/ai/types").ProposalView[];
  counts: Record<string, number>;
  run: import("@/lib/ai/runner").RunStatusView | null;
  taskRuns: Record<string, import("@/lib/ai/runner").RunStatusView | null>;
  totalMemory: number;
};

function Analysis() {
  const data = useLoaderData() as AnalysisData;
  const chapters = data.chapters.map((chapter, index) => ({
    id: chapter.id, index: index + 1, title: chapter.rawTitle, charCount: chapter.charCount,
  }));
  const tasks: import("@/lib/ai/tasks/registry").TaskSummary[] = [{
    type: "chapter-extract", label: "逐章抽取", scope: "chapter" as const, unitLabel: "章",
    description: "逐章理解原文，产出章节笔记、事件、人物、设定、悬念与术语提案。",
    requirement: null,
  },{
    type: "book-synthesis", label: "全书统合", scope: "project", unitLabel: "项",
    description: "在已有记忆之上统合全书，产出概要、结局状态、未决线索与续写约束。",
    requirement: "memory",
  }];
  return <AnalysisPanel key={data.project.id} projectId={data.project.id} projectName={data.project.name}
    chapters={chapters} profiles={data.profiles} tasks={tasks} initialProposals={data.proposals}
    initialCounts={data.counts} initialRun={data.run} taskRuns={data.taskRuns}
    totalMemory={data.totalMemory} hasMemory={data.totalMemory > 0} initialStage={data.run?.taskType ?? null} />;
}

function Settings() {
  const profiles = useLoaderData() as { profiles: import("@/lib/ai/profiles").ProfileView[]; encryptionReady: boolean; keyError?: string };
  const [directory, setDirectory] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const [restoring, setRestoring] = useState(false);
  const { revalidate } = useRevalidator();
  useEffect(() => { void invoke<{ dataDir: string }>("get_storage").then((value) => setDirectory(value.dataDir)).catch((error: unknown) => notify.error(String(error))); }, []);
  async function copy() {
    setBusy(true);
    try {
      const result = await invoke<{ dataDir: string } | null>("copy_workspace");
      if (result) { setDirectory(result.dataDir); await revalidate(); notify.success("工作区已复制并打开，原目录已保留。"); }
    } catch (error) { notify.error(String(error)); }
    finally { setBusy(false); }
  }
  async function restoreKey() {
    setRestoring(true);
    try {
      await api("/api/model-profiles/key", "POST", { key: key.trim() });
      setKey("");
      revalidate();
      notify.success("已恢复工作区主密钥。");
    } catch (error) { notify.error(String(error)); }
    finally { setRestoring(false); }
  }
  return <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 lg:px-6">
    <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
    {!profiles.encryptionReady && <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><KeyRound className="size-4" />恢复工作区主密钥</CardTitle>
      <CardDescription>{profiles.keyError ?? "此工作区需要原主密钥才能读取模型档案。"}</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row"><input type="password" value={key} onChange={(event) => setKey(event.target.value)}
        autoComplete="off" aria-label="工作区主密钥" placeholder="原 .env 中的 64 位十六进制主密钥" className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm" />
        <Button disabled={restoring || key.trim().length !== 64} onClick={() => void restoreKey()}>{restoring ? "验证中…" : "验证并恢复"}</Button></CardContent></Card>}
    <ProfileManager profiles={profiles.profiles} encryptionReady={profiles.encryptionReady} />
    <Card><CardHeader><CardTitle className="text-base">数据保存位置</CardTitle><CardDescription>小说项目和原文保存在本机工作区中。</CardDescription></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="break-all text-muted-foreground">当前目录：{directory || "正在读取…"}</p>
        <p className="text-muted-foreground">从已有工作区复制项目、原文和配置到独立目录，保留原目录。</p>
        <Button variant="outline" disabled={busy} onClick={() => void copy()}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <FolderOpen className="size-4" />}{busy ? "正在复制…" : "从已有工作区复制"}</Button>
      </CardContent>
    </Card>
  </div>;
}

function MigrationPage() {
  const data = useLoaderData() as Workspace;
  return <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 lg:px-6">
    <ProjectNav projectId={data.project.id} />
    <h1 className="text-2xl font-semibold tracking-tight">{data.project.name}</h1>
    <Card><CardHeader><CardTitle className="text-base">此功能正在迁移</CardTitle><CardDescription>当前预览版已开放项目库和章节校对；记忆、理解分析和续写功能请继续使用正式版。</CardDescription></CardHeader>
      <CardContent><Link className="text-primary underline" to={`/projects/${data.project.id}`}>返回章节校对</Link></CardContent>
    </Card>
  </div>;
}

function ErrorPage() {
  const error = useRouteError();
  return <div className="mx-auto max-w-3xl space-y-4 px-6 py-12" role="alert"><h1 className="text-xl font-semibold">无法打开工作区</h1>
    <p>{error instanceof Error ? error.message : String(error)}</p>
    <Button variant="outline" onClick={() => location.reload()}>重新打开</Button>
  </div>;
}

const workspaceLoader = ({ params }: { params: Record<string, string | undefined> }) => api<Workspace>(`/api/projects/${params.id}/workspace`);
const memoryLoader = async ({ params }: { params: Record<string, string | undefined> }): Promise<MemoryData> => {
  const [workspace, memory, knowledge] = await Promise.all([
    workspaceLoader({ params }),
    api<MemoryData["memory"]>(`/api/projects/${params.id}/memory`),
    api<{ knowledge: MemoryData["knowledge"] }>(`/api/projects/${params.id}/knowledge`),
  ]);
  return { ...workspace, memory, knowledge: knowledge.knowledge };
};
const analysisLoader = async ({ params }: { params: Record<string, string | undefined> }): Promise<AnalysisData> => {
  const id = params.id;
  const [workspace, profiles, proposals, latest, memory] = await Promise.all([
    workspaceLoader({ params }),
    api<{ profiles: AnalysisData["profiles"] }>("/api/model-profiles"),
    api<{ proposals: AnalysisData["proposals"]; counts: Record<string, number> }>(`/api/projects/${id}/proposals`),
    api<{ run: AnalysisData["run"]; taskRuns: AnalysisData["taskRuns"] }>(`/api/projects/${id}/analysis`),
    api<{ counts: Record<string, number> }>(`/api/projects/${id}/memory`),
  ]);
  return { ...workspace, profiles: profiles.profiles, proposals: proposals.proposals, counts: proposals.counts,
    run: latest.run, taskRuns: latest.taskRuns,
    totalMemory: Object.values(memory.counts).reduce((sum, count) => sum + count, 0) };
};
const router = createHashRouter([{
  element: <Shell />, errorElement: <ErrorPage />, children: [
    { path: "/", loader: () => api("/api/projects"), element: <Library /> },
    { path: "/settings", loader: () => api("/api/model-profiles"), element: <Settings /> },
    { path: "/projects/:id", loader: workspaceLoader, element: <Chapters /> },
    { path: "/projects/:id/memory", loader: memoryLoader, element: <Memory /> },
    { path: "/projects/:id/analysis", loader: analysisLoader, element: <Analysis /> },
    { path: "/projects/:id/:section", loader: workspaceLoader, element: <MigrationPage /> },
  ],
}]);

createRoot(document.getElementById("root")!).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
