const {contextBridge,ipcRenderer}=require("electron");
contextBridge.exposeInMainWorld("changyi",{
  configuration:()=>ipcRenderer.invoke("changyi:configuration"),
  configure:(url)=>ipcRenderer.invoke("changyi:configure",url),
  request:(input)=>ipcRenderer.invoke("changyi:request",input),
  localProfile:(id)=>ipcRenderer.invoke("changyi:local-profile",id),
  saveLocalProfile:(id,input)=>ipcRenderer.invoke("changyi:save-local-profile",id,input),
  removeLocalProfile:(id)=>ipcRenderer.invoke("changyi:remove-local-profile",id),
  infer:(id,profileId,request)=>ipcRenderer.invoke("changyi:infer",id,profileId,request),
  cancelInference:(id)=>ipcRenderer.invoke("changyi:cancel-inference",id),
});
