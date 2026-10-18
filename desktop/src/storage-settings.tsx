import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type StorageInfo = { dataDir: string; startupError?: string | null };
export function NativeStorageSettings() {
  const [info,setInfo]=useState<StorageInfo|null>(null);
  const [directory,setDirectory]=useState("");
  const [pending,setPending]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{
    void invoke<StorageInfo>("get_storage").then((value)=>{setInfo(value);setDirectory(value.dataDir);})
      .catch((value:unknown)=>setError(String(value)));
  },[]);
  async function choose(){
    setPending(true);setError("");
    try{const value=await invoke<string|null>("choose_directory");if(value)setDirectory(value);}
    catch(value){setError(String(value));}finally{setPending(false);}
  }
  function reopen(){location.hash="/";location.reload();}
  async function apply(){
    setPending(true);setError("");
    try{await invoke("apply_storage",{directory});reopen();}
    catch(value){setError(String(value));}finally{setPending(false);}
  }
  async function copy(){
    setPending(true);setError("");
    try{const value=await invoke<StorageInfo|null>("copy_workspace");if(value)reopen();}
    catch(value){setError(String(value));}finally{setPending(false);}
  }
  return <Card><CardHeader>
    <CardTitle className="flex items-center gap-2 text-base"><FolderOpen className="size-4"/>数据保存位置</CardTitle>
    <CardDescription>小说项目、原文和模型配置统一保存在所选文件夹中。</CardDescription>
  </CardHeader><CardContent className="space-y-4 text-sm" aria-busy={pending}>
    {info?.startupError && <p role="alert" className="rounded-md border border-warning/40 bg-warning/5 p-3 text-warning">{info.startupError}</p>}
    <div className="space-y-2"><Label htmlFor="storage-destination">保存文件夹</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id="storage-destination" value={directory} readOnly className="h-11 min-w-0 flex-1"/>
        <Button variant="outline" className="h-11" disabled={pending} onClick={()=>void choose()}><FolderOpen className="size-4"/>选择文件夹</Button>
      </div>
    </div>
    {info && directory!==info.dataDir && <p className="break-all text-muted-foreground">当前使用：{info.dataDir}</p>}
    <p className="leading-relaxed text-muted-foreground">更换到空文件夹会自动带上当前数据；选中已有工作区会直接打开。原目录会保留。</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2 border-t pt-4">
      <Button className="h-11" disabled={pending || !directory || directory===info?.dataDir} onClick={()=>void apply()}>
        {pending && <LoaderCircle className="size-4 animate-spin"/>}{pending?"正在处理…":"保存并重新打开"}
      </Button>
      <Button className="h-11" variant="outline" disabled={pending} onClick={()=>void invoke("open_storage").catch((value:unknown)=>setError(String(value)))}>打开当前文件夹</Button>
      <Button className="h-11" variant="outline" disabled={pending} onClick={()=>void copy()}>从已有工作区复制</Button>
    </div>
    <p className="text-xs text-muted-foreground">更换目录前，请先等待正在进行的任务结束。</p>
  </CardContent></Card>;
}
