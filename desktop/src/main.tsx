import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider, Outlet, useLoaderData, useRevalidator, useRouteError, Link } from "react-router-dom";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, FolderOpen, LoaderCircle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { OperationPromptHost, notify } from "@/components/operation-prompt";
import { ProjectLibrary } from "@/components/projects/project-library";
import { ChapterWorkspace } from "@/components/projects/chapter-workspace";
import { ProjectNav } from "@/components/projects/project-nav";
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

function Settings() {
  const [directory, setDirectory] = useState("");
  const [busy, setBusy] = useState(false);
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
  return <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 lg:px-6">
    <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
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
const router = createHashRouter([{
  element: <Shell />, errorElement: <ErrorPage />, children: [
    { path: "/", loader: () => api("/api/projects"), element: <Library /> },
    { path: "/settings", element: <Settings /> },
    { path: "/projects/:id", loader: workspaceLoader, element: <Chapters /> },
    { path: "/projects/:id/:section", loader: workspaceLoader, element: <MigrationPage /> },
  ],
}]);

createRoot(document.getElementById("root")!).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
