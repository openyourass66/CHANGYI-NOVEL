const {contextBridge,ipcRenderer}=require("electron");
async function invoke(channel,...args){
  let reply;
  try{reply=await ipcRenderer.invoke(channel,...args);}catch{throw new Error("操作暂不可用，请重新启动客户端后重试。");}
  if(!reply?.ok)throw new Error(reply?.error||"操作失败，请重试。");
  return reply.data;
}
contextBridge.exposeInMainWorld("changyi",{
  configuration:()=>invoke("changyi:configuration"),
  request:(input)=>invoke("changyi:request",input),
  localProfile:(id)=>invoke("changyi:local-profile",id),
  saveLocalProfile:(id,input)=>invoke("changyi:save-local-profile",id,input),
  removeLocalProfile:(id)=>invoke("changyi:remove-local-profile",id),
  infer:(id,profileId,request)=>invoke("changyi:infer",id,profileId,request),
  cancelInference:(id)=>invoke("changyi:cancel-inference",id),
});
