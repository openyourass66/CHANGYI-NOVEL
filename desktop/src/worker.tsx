import { useEffect } from "react";
import type { DeviceJob } from "@contracts/desktop";
import { apiJson } from "@/lib/client-api";
export function DeviceWorker({deviceId,userId}:{deviceId:string;userId?:string}) {
  useEffect(()=>{
    if(!userId||!window.changyi)return;
    let disposed=false,claiming=false;
    const active=new Set<string>();
    async function execute(job:DeviceJob){
      active.add(job.id);
      const monitor=setInterval(()=>{
        void apiJson<{run:{status:string}}>(`/api/v1/analysis/${job.runId}`).then(({run})=>{if(["canceled","failed","done","stalled"].includes(run.status))void window.changyi!.cancelInference(job.id);}).catch(error=>{if(error.status===401||error.status===404)void window.changyi!.cancelInference(job.id);});
      },1500);
      const resultPath=`/api/v1/device-inferences/${job.id}/result`;
      const post=(data:unknown)=>apiJson(resultPath,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({deviceId,leaseToken:job.leaseToken,...data as object})});
      try{const result=await window.changyi!.infer(job.id,job.profileId,job.request);if(!disposed)await post({result});}
      catch{if(!disposed)await post({error:"本机模型调用失败，请检查当前设备的模型配置、连接或运行日志后重试。"}).catch(()=>{});}
      finally{clearInterval(monitor);active.delete(job.id);}
    }
    async function tick(){
      if(disposed||claiming||active.size>=2)return;
      claiming=true;
      try{const {job}=await apiJson<{job:DeviceJob|null}>("/api/v1/device-inferences/claim",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({deviceId})});if(job){if(disposed)await window.changyi!.cancelInference(job.id);else void execute(job);}}
      catch{/* 断网期间保留服务端任务状态，下次连接后继续领取。 */}finally{claiming=false;}
    }
    void tick();const timer=setInterval(tick,1000);
    return()=>{disposed=true;clearInterval(timer);for(const id of active)void window.changyi!.cancelInference(id);};
  },[deviceId,userId]);
  return null;
}
