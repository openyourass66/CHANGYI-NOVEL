import { app, BrowserWindow, ipcMain, protocol, net, safeStorage, session } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createVault } from "./vault.mjs";
import { service } from "./service.mjs";
import { localModels } from "./local-model.mjs";
import { readReleaseTarget, runtimeServerURL } from "./release-target.mjs";
const directory=path.dirname(fileURLToPath(import.meta.url));
const smoke=!app.isPackaged&&process.argv.includes("--smoke");
if(smoke && process.env.CHANGYI_SMOKE_DATA) app.setPath("userData",process.env.CHANGYI_SMOKE_DATA);
if(smoke) process.on("uncaughtException",error=>{console.error("Smoke startup failed: "+error.message);app.exit(1);});
protocol.registerSchemesAsPrivileged([{scheme:"changyi",privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
if(!app.requestSingleInstanceLock())app.quit();
else {
  void app.whenReady().then(async()=>{
  const vault=await createVault(app.getPath("userData"),safeStorage);
  // 发布地址由构建产物决定，覆盖旧版本保存的手动地址；保留各服务的独立凭据桶。
  vault.state.serverURL=runtimeServerURL(readReleaseTarget(),{isPackaged:app.isPackaged,smoke,testURL:process.env.CHANGYI_INTEGRATION_URL||process.env.CHANGYI_SMOKE_URL});
  const api=service(vault),models=localModels(vault,api);
  const config=()=>({deviceId:vault.state.deviceId,version:app.getVersion()});
  const devURL=!app.isPackaged&&process.env.CHANGYI_DEV_URL;
  if(devURL&&!/^http:\/\/127\.0\.0\.1:5173\/?$/.test(devURL))throw new Error("开发地址无效。");
  const root=path.resolve(directory,"../dist");
  protocol.handle("changyi",request=>{
    const url=new URL(request.url);
    if(url.hostname!=="app")return new Response(null,{status:404});
    let relative;try{relative=decodeURIComponent(url.pathname);}catch{return new Response(null,{status:400});}
    const target=path.resolve(root,"."+(relative==="/"?"/index.html":relative));
    if(path.relative(root,target).startsWith("..")||path.isAbsolute(path.relative(root,target)))return new Response(null,{status:403});
    return net.fetch(pathToFileURL(target).href);
  });
  session.defaultSession.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  let window;
  function trusted(event){
    if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw new Error("请求来源无效。");
    const url=new URL(event.senderFrame.url);
    if(devURL?url.origin!==new URL(devURL).origin:url.protocol!=="changyi:"||url.host!=="app")throw new Error("请求来源无效。");
  }
  const handlers={configuration:config,request:api.request,"local-profile":models.read,"save-local-profile":models.save,"remove-local-profile":models.remove,infer:models.infer,"cancel-inference":models.cancel};
  for(const [name,handler] of Object.entries(handlers))ipcMain.handle("changyi:"+name,async(event,...args)=>{
    try{trusted(event);return {ok:true,data:await handler(...args)};}
    catch(error){return {ok:false,error:error.message||"操作失败，请重试。"};}
  });
  async function open(){
    window=new BrowserWindow({width:1280,height:860,minWidth:900,minHeight:650,show:!smoke,autoHideMenuBar:true,title:"长忆",webPreferences:{preload:path.join(directory,"preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
    window.webContents.setWindowOpenHandler(()=>({action:"deny"}));
    if(smoke)window.webContents.on("console-message",(_event,details)=>{if(details.level==="error")console.error("Renderer: "+details.message);});
    window.webContents.on("will-navigate",(event,url)=>{
      const target=new URL(url);
      if(devURL?target.origin!==new URL(devURL).origin:target.protocol!=="changyi:"||target.host!=="app")event.preventDefault();
    });
    window.webContents.on("will-attach-webview",event=>event.preventDefault());
    window.on("closed",()=>{models.cancelAll();window=undefined;});
    await window.loadURL((devURL||"changyi://app/index.html")+"#/login");
  }
  await open();
  app.on("second-instance",()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
  app.on("activate",()=>{if(!window)void open();});
  app.on("window-all-closed",()=>app.quit());
  if(smoke){try{await(await import(process.env.CHANGYI_INTEGRATION_URL?"./integration.mjs":"./smoke.mjs")).run(window,vault);app.exit(0);}catch(error){console.error(error.message);app.exit(1);}}
  }).catch(error=>{console.error("Desktop startup failed: "+error.message);app.exit(1);});
}
