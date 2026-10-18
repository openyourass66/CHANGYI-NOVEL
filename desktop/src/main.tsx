import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider, Navigate, Outlet, useLoaderData, useRevalidator, useRouteError, Link } from "react-router-dom";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, KeyRound } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { OperationPromptHost, notify } from "@/components/operation-prompt";
import { ProjectLibrary } from "@/components/projects/project-library";
import { ChapterWorkspace } from "@/components/projects/chapter-workspace";
import { MemoryWorkbench } from "@/components/projects/memory-workbench";
import { AnalysisPanel } from "@/components/projects/analysis-panel";
import { ContinuationPanel } from "@/components/projects/continuation-panel";
import { ProfileManager } from "@/components/settings/profile-manager";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatLabel } from "@/lib/domain";
import type { ProjectSummary } from "@/lib/projects-view";
import type { ChapterSummary } from "@/lib/chapters-view";
import { api, installBridge } from "./bridge";
import { NativeStorageSettings } from "./storage-settings";
import "./styles.css";
import { AutomationProvider, AutomationSettings, useAutoContinue, useWorkflows } from "./automation";
import { Reader } from "./reader";
import { WorksLibrary } from "./works";

installBridge();
if (isTauri()) document.documentElement.dataset.nativeDesktop = "true";
let startupChecked = false;

type Workspace = {
  project: { id: string; name: string; genre: string | null };
  source: { fileName: string; format: string; byteSize: number; encoding: string | null; importedAt: string } | null;
  chapters: ChapterSummary[];
};

function Shell() {
  useEffect(() => {
    if (!isTauri()) return;
    if (!startupChecked) {
      startupChecked = true;
      void invoke<{startupError?:string|null}>("get_storage")
        .then((info)=>{if(info.startupError)notify.warning(info.startupError);})
        .catch((error:unknown)=>notify.error(String(error)));
    }
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
    <AppShell><AutomationProvider><Outlet /></AutomationProvider></AppShell>
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

function WorksLibraryPage() {
  const data = useLoaderData() as { works: import("./works").Work[] };
  return <WorksLibrary key={data.works.map((work) => work.id).join(";")} />;
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
  return <AnalysisPanel key={`${data.project.id}:${data.run?.id}`} projectId={data.project.id} projectName={data.project.name}
    chapters={chapters} profiles={data.profiles} tasks={tasks} initialProposals={data.proposals}
    initialCounts={data.counts} initialRun={data.run} taskRuns={data.taskRuns}
    totalMemory={data.totalMemory} hasMemory={data.totalMemory > 0} initialStage={data.run?.taskType ?? null} />;
}

type ContinuationData = Workspace & {
  profiles: import("@/lib/ai/profiles").ProfileView[];
  plans: import("@/lib/continuation-view").ContinuationPlanView[];
  run: import("@/lib/ai/runner").RunStatusView | null;
  taskRuns: Record<string, import("@/lib/ai/runner").RunStatusView | null>;
  hasMemory: boolean;
};

function Continuation() {
  const data=useLoaderData() as ContinuationData;
  const automatic = useAutoContinue(data.project.id, data.profiles);
  const workflows = useWorkflows();
  const active = workflows.some((w) => w.projectId === data.project.id && w.status === "running");
  const tasks: import("@/lib/ai/tasks/registry").TaskSummary[]=[
    {type:"direction",label:"生成续写方向",scope:"project",unitLabel:"项",
      description:"依据记忆与最近原文，提出 3 个差异明显的续写方向供你择一。",requirement:"memory"},
    {type:"outline",label:"生成章纲",scope:"project",unitLabel:"项",
      description:"为已选定的方向排出接下来若干章的章纲，写入该方向并递增其版本。",requirement:"plan"},
    {type:"draft",label:"生成草稿",scope:"project",unitLabel:"项",
      description:"按章纲逐章写出续写草稿，上一章会作为前情注入；草稿可人工编辑。",requirement:"outline"},
    {type:"continuity-check",label:"检查连续性",scope:"project",unitLabel:"项",
      description:"逐章核对续写草稿与既有记忆、原文是否自洽，产出待核对的问题与证据。",requirement:"drafts"},
    {type:"draft-memory",label:"提取记忆变化",scope:"project",unitLabel:"项",
      description:"从续写草稿里提取相对既有记忆的增量，产出待确认的记忆提案。",requirement:"drafts"},
  ];
  return <><ContinuationPanel key={`${data.project.id}:${data.run?.id}`} projectId={data.project.id} projectName={data.project.name}
    profiles={data.profiles} tasks={tasks} initialPlans={data.plans} initialRun={data.run}
    taskRuns={data.taskRuns} hasMemory={data.hasMemory} initialStage={data.run?.taskType ?? null}
    onAutoContinue={automatic.request} automationActive={active}
    onExportText={async(fileName,text)=>{await invoke("save_text",{fileName,text});}}/>{automatic.dialog}</>;
}

function Settings() {
  const profiles = useLoaderData() as { profiles: import("@/lib/ai/profiles").ProfileView[]; encryptionReady: boolean; keyError?: string };
  const [key, setKey] = useState("");
  const [restoring, setRestoring] = useState(false);
  const { revalidate } = useRevalidator();
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
    <AutomationSettings />
    <NativeStorageSettings/>
  </div>;
}

function NotFoundPage() {
  return <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 lg:px-6">
    <h1 className="text-2xl font-semibold tracking-tight">页面不存在</h1>
    <Link className="text-primary underline" to="/">返回项目库</Link>
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
    run: newestRun(latest.taskRuns,["chapter-extract","book-synthesis"]), taskRuns: latest.taskRuns,
    totalMemory: Object.values(memory.counts).reduce((sum, count) => sum + count, 0) };
};
function newestRun(runs:Record<string,import("@/lib/ai/runner").RunStatusView|null>,types:string[]) {
  return types.map((type)=>runs[type]).filter((run):run is import("@/lib/ai/runner").RunStatusView=>Boolean(run))
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}
const continuationLoader=async ({params}:{params:Record<string,string|undefined>}):Promise<ContinuationData>=>{
  const id=params.id;
  const [workspace,profiles,plans,latest,memory]=await Promise.all([
    workspaceLoader({params}),
    api<{profiles:ContinuationData["profiles"]}>("/api/model-profiles"),
    api<{plans:ContinuationData["plans"]}>(`/api/projects/${id}/plans`),
    api<{taskRuns:ContinuationData["taskRuns"]}>(`/api/projects/${id}/analysis`),
    api<{counts:Record<string,number>}>(`/api/projects/${id}/memory`),
  ]);
  return {...workspace,profiles:profiles.profiles,plans:plans.plans,taskRuns:latest.taskRuns,
    run:newestRun(latest.taskRuns,["direction","outline","draft","continuity-check","draft-memory"]),
    hasMemory:Object.values(memory.counts).some((count)=>count>0)};
};
const router = createHashRouter([{
  element: <Shell />, errorElement: <ErrorPage />, children: [
    { path: "/", loader: () => api("/api/projects"), element: <Library /> },
    { path: "/settings", loader: () => api("/api/model-profiles"), element: <Settings /> },
    { path: "/works", loader: () => api("/api/works"), element: <WorksLibraryPage /> },
    { path: "/works/:workId", loader: ({params}) => api(`/api/works/${params.workId}`), element: <Reader /> },
    { path: "/projects/:id", loader: workspaceLoader, element: <Chapters /> },
    { path: "/projects/:id/memory", loader: memoryLoader, element: <Memory /> },
    { path: "/projects/:id/analysis", loader: analysisLoader, element: <Analysis /> },
    { path: "/projects/:id/continuation", loader: continuationLoader, element: <Continuation /> },
    { path: "/projects/:id/read", element: <Navigate to="/works" replace /> },
    { path: "*", element: <NotFoundPage /> },
  ],
}]);

createRoot(document.getElementById("root")!).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
