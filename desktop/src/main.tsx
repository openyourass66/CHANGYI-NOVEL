import React, { useCallback, useContext, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Navigate, useLocation } from "react-router-dom";
import type { DesktopConfiguration } from "@contracts/desktop";
import type { ProjectSummary } from "@contracts/api";
import type { SettingsView, WorkspaceView as WorkspaceData } from "@contracts/workspace";
import { apiJson } from "@/lib/client-api";
import { authClient } from "@/lib/auth-client";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { OperationPromptHost } from "@/components/operation-prompt";
import { AccountForm, type AccountMode } from "@/components/account-form";
import { ProjectLibrary } from "@/components/projects/project-library";
import { WorkspaceView } from "@/components/projects/workspace-view";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { Button } from "@/components/ui/button";
import { RefreshContext } from "./navigation";
import { DeviceWorker } from "./worker";
import "./style.css";

function ConnectionStatus() {
  const [status,setStatus]=useState<"checking"|"ready"|"unavailable">("checking");
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let active=true;
    void apiJson("/api/v1/health").then(()=>{if(active)setStatus("ready");}).catch(()=>{if(active)setStatus("unavailable");});
    return()=>{active=false;};
  },[attempt]);
  if(status==="ready")return null;
  return <div role={status==="unavailable"?"alert":"status"} className="flex items-center justify-center gap-3 border-b bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
    <span>{status==="checking"?"正在连接服务…":"暂时无法连接服务，请检查网络或稍后重试。"}</span>
    {status==="unavailable"&&<Button variant="outline" size="sm" onClick={()=>{setStatus("checking");setAttempt(value=>value+1);}}>重试连接</Button>}
  </div>;
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
    {location.pathname==="/login"?(session.data?<Navigate to="/" replace/>:<AccountForm key={mode} mode={mode}/>):session.isPending?<p className="p-8" role="status">正在读取账号…</p>:!session.data?<Navigate to="/login" replace/>:<RemotePage revision={revision}/>}
    <DeviceWorker deviceId={config.deviceId} userId={session.data?.user.id}/>
  </AppShell></RefreshContext.Provider>;
}
function App(){
  const [configuration,setConfiguration]=useState<DesktopConfiguration|null>(null),[error,setError]=useState("");
  useEffect(()=>{if(!window.changyi){setError("请通过桌面应用打开工作台。");return;}void window.changyi.configuration().then(setConfiguration).catch(()=>setError("无法启动客户端，请重新打开后重试。"));},[]);
  if(error)return <p role="alert" className="p-8">{error}</p>;
  if(!configuration)return <p role="status" className="p-8">正在启动…</p>;
  return <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
    <HashRouter><ConnectionStatus/><Screens config={configuration}/></HashRouter><OperationPromptHost/>
  </ThemeProvider>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
