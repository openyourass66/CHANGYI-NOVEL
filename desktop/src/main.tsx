import React, { useCallback, useContext, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Navigate, useLocation } from "react-router-dom";
import type { DesktopConfiguration } from "@contracts/desktop";
import type { ProjectSummary } from "@contracts/api";
import type { SettingsView, WorkspaceKind, WorkspaceView as WorkspaceData } from "@contracts/workspace";
import { apiJson } from "@/lib/client-api";
import { authClient } from "@/lib/auth-client";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { AccountForm, type AccountMode } from "@/components/account-form";
import { ProjectLibrary } from "@/components/projects/project-library";
import { WorkspaceView } from "@/components/projects/workspace-view";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RefreshContext } from "./navigation";
import { DeviceWorker } from "./worker";
import "./style.css";

function Connection({ initial, done }: { initial?: string; done: (config: DesktopConfiguration) => void }) {
  const [url,setURL]=useState(initial??"");const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  return <form className="mx-auto mt-20 max-w-lg space-y-4 rounded-xl border p-6" onSubmit={async(event)=>{
    event.preventDefault();setBusy(true);setError("");
    try{const config=await window.changyi!.configure(url.trim());await apiJson("/api/v1/health");done(config);}
    catch(error){setError(error instanceof Error?error.message:"连接失败。");}finally{setBusy(false);}
  }}><h1 className="text-xl font-semibold">连接长忆服务</h1><p className="text-sm text-muted-foreground">填写服务地址，登录后即可访问你的小说项目。</p><Label htmlFor="serverURL">服务地址</Label><Input id="serverURL" type="url" required value={url} onChange={e=>setURL(e.target.value)} placeholder="https://novel.example.com" disabled={busy}/><p className="text-xs text-muted-foreground">私有网络自测可填写虚拟机的 HTTP 地址。</p>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<Button disabled={busy}>{busy?"正在连接…":"连接服务"}</Button></form>;
}

function RemotePage({ revision }: { revision: number }) {
  const retry = useContext(RefreshContext);
  const location=useLocation();const path=location.pathname;
  const match=path.match(/^\/projects\/([^/]+)(?:\/(analysis|memory|continuation))?$/);
  const resource=path==="/"?"/api/v1/projects":path==="/settings"?"/api/v1/settings":match?`/api/v1/workspaces/${encodeURIComponent(match[1])}?view=${match[2]??"chapters"}`:null;
  const [state,setState]=useState<{resource:string|null;data:unknown;error:string;status?:number}>({resource:null,data:null,error:""});
  useEffect(()=>{
    if(!resource)return;
    let active=true;
    void apiJson(resource).then(data=>{if(active)setState({resource,data,error:""});}).catch(error=>{if(active)setState(previous=>({resource,data:previous.resource===resource?previous.data:null,error:error.message,status:error.status}));});
    return()=>{active=false;};
  },[resource,revision]);
  if(!resource)return <p className="p-8">页面不存在。</p>;
  if(state.status===401)return <Navigate to="/login" replace/>;
  if(state.resource!==resource)return <p className="p-8" role="status">正在加载…</p>;
  const error=state.error&&<div className="m-4 rounded-md border border-destructive p-4 text-sm" role="alert">{state.error} <Button variant="outline" size="sm" onClick={retry}>重新连接</Button></div>;
  if(!state.data)return <>{error}</>;
  return <>{error}{path==="/"?<ProjectLibrary projects={(state.data as {projects:ProjectSummary[]}).projects}/>:path==="/settings"?<SettingsPanel {...state.data as SettingsView}/>:<WorkspaceView key={`${match![1]}:${match![2]??"chapters"}`} data={(state.data as {workspace:WorkspaceData}).workspace} focusEntryId={new URLSearchParams(location.search).get("entry")}/>}</>;
}

function Screens({config}: {config: DesktopConfiguration}) {
  const location=useLocation();const session=authClient.useSession();const [revision,setRevision]=useState(0);
  const refresh=useCallback(()=>setRevision(r=>r+1),[]);
  const query=new URLSearchParams(location.search),requested=query.get("mode");
  const mode:AccountMode=requested==="register"||requested==="forgot"?requested:"login";
  return <RefreshContext.Provider value={refresh}><AppShell>
    {location.pathname==="/login"?<AccountForm key={mode} mode={mode}/>:session.isPending?<p className="p-8" role="status">正在读取账号…</p>:!session.data?<Navigate to="/login" replace/>:<RemotePage revision={revision}/>}
    <DeviceWorker deviceId={config.deviceId} userId={session.data?.user.id}/>
  </AppShell></RefreshContext.Provider>;
}
function App(){
  const [configuration,setConfiguration]=useState<DesktopConfiguration|null>(null),[editing,setEditing]=useState(false),[error,setError]=useState("");
  useEffect(()=>{if(!window.changyi){setError("请通过桌面应用打开工作台。");return;}void window.changyi.configuration().then(setConfiguration).catch(()=>setError("无法读取本机连接配置。"));},[]);
  if(error)return <p role="alert" className="p-8">{error}</p>;
  if(!configuration)return <p role="status" className="p-8">正在启动…</p>;
  return <ThemeProvider attribute="class" defaultTheme="system" enableSystem><div className="flex items-center justify-between border-b px-4 py-1 text-xs text-muted-foreground"><span>{configuration.serverURL||"尚未连接服务"}</span><button className="rounded px-2 py-1 hover:bg-accent" onClick={()=>setEditing(!editing)}>{editing?"返回工作台":"更换服务"}</button></div>
    {!configuration.serverURL||editing?<Connection initial={configuration.serverURL} done={config=>{setConfiguration(config);setEditing(false);window.location.hash="/login";window.location.reload();}}/>:<HashRouter><Screens config={configuration}/></HashRouter>}<Toaster position="bottom-right"/>
  </ThemeProvider>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
