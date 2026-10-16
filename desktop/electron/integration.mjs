import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
export async function run(window,vault) {
  const evaluate=code=>window.webContents.executeJavaScript(`(async()=>{${code}})()`);
  const api=async(route,method="GET",body)=>{
    const result=await evaluate(`const r=await window.changyi.request({path:${JSON.stringify(route)},method:${JSON.stringify(method)},headers:{"Content-Type":"application/json"},body:${body===undefined?"undefined":`new TextEncoder().encode(${JSON.stringify(JSON.stringify(body))}).buffer`}});return {status:r.status,body:new TextDecoder().decode(r.body)};`);
    assert(result.status<400,route+": "+result.body);return JSON.parse(result.body);
  };
  const wait=async(read,done)=>{for(let i=0;i<100;i++){const value=await read();if(done(value))return value;await new Promise(r=>setTimeout(r,200));}throw new Error("桌面端到接口的流程等待超时");};
  await api("/api/v1/auth/sign-in/email","POST",{email:process.env.CHANGYI_INTEGRATION_EMAIL,password:process.env.CHANGYI_INTEGRATION_PASSWORD});
  const {project}=await api("/api/v1/projects","POST",{name:"桌面隔离联调"});
  const imported=await evaluate(`const form=new FormData();form.set("file",new File(["第一章 本机测试\\n桌面链路测试正文。"],"desktop-fixture.txt",{type:"text/plain"}));const request=new Request("https://desktop.local/api/v1/projects/${project.id}/import",{method:"POST",body:form});const response=await window.changyi.request({path:"/api/v1/projects/${project.id}/import",method:"POST",headers:Object.fromEntries(request.headers),body:await request.arrayBuffer()});return {status:response.status,body:new TextDecoder().decode(response.body)};`);
  assert(imported.status<400,imported.body);
  const {chapters}=await api(`/api/v1/projects/${project.id}/chapters`);assert(chapters.length>0);
  const chapter=await api(`/api/v1/chapters/${chapters[0].id}`);assert(JSON.stringify(chapter).includes("桌面链路测试正文。"));
  const {profile}=await api("/api/v1/model-profiles","POST",{name:"当前设备",provider:"ollama",model:"fixture-local",isLocal:true});
  await evaluate(`await window.changyi.saveLocalProfile(${JSON.stringify(profile.id)},{provider:"ollama",model:"fixture-local",baseUrl:${JSON.stringify(process.env.CHANGYI_LOCAL_MODEL_URL)},apiKey:"device-local-fixture-key"});`);
  const loaded=new Promise(resolve=>window.webContents.once("did-finish-load",resolve));window.webContents.reload();await loaded;
  await wait(()=>evaluate('return document.body.innerText;'),text=>text.includes("桌面隔离联调"));
  await evaluate(`window.location.hash="/projects/${project.id}";`);
  await wait(()=>evaluate('return document.body.innerText;'),text=>text.includes("本机测试"));
  const {runId}=await api(`/api/v1/projects/${project.id}/analysis`,"POST",{profileId:profile.id,deviceId:vault.state.deviceId,taskType:"chapter-extract"});
  const completed=await wait(()=>api(`/api/v1/analysis/${runId}`),data=>["done","failed"].includes(data.run.status));assert.equal(completed.run.status,"done",completed.run.error);
  const proposals=await api(`/api/v1/projects/${project.id}/proposals`);assert(JSON.stringify(proposals).includes("桌面设备分析完成"));
  const {entry}=await api(`/api/v1/projects/${project.id}/memory`,"POST",{category:"story-bible",title:"桌面记忆",content:"初始记忆",status:"confirmed"});
  await api(`/api/v1/memory/${entry.id}`,"PATCH",{category:"story-bible",title:"桌面记忆",status:"confirmed",content:"桌面编辑已保存"});
  for(const view of ["analysis","memory","continuation"]){const data=await api(`/api/v1/workspaces/${project.id}?view=${view}`);assert.equal(data.workspace.view,view);}
  const exported=await evaluate(`const r=await window.changyi.request({path:"/api/v1/projects/${project.id}/export?format=json",method:"GET",headers:{}});return {status:r.status,headers:r.headers,text:new TextDecoder().decode(r.body)};`);assert.equal(exported.status,200);assert(exported.text.includes("桌面编辑已保存"));assert(!exported.text.includes("device-local-fixture-key"));
  const image=await window.webContents.capturePage();await writeFile(path.join(process.env.CHANGYI_SMOKE_DATA,"integration.png"),image.toPNG());
  await api(`/api/v1/projects/${project.id}`,"DELETE");await api(`/api/v1/model-profiles/${profile.id}`,"DELETE");await evaluate(`await window.changyi.removeLocalProfile(${JSON.stringify(profile.id)});`);
  console.log("PASS: real isolated server + packaged desktop UI: encrypted login, multipart import, chapter reading, device worker/native inference, validated proposals, memory edit, continuation view and export. Screenshot: "+path.join(process.env.CHANGYI_SMOKE_DATA,"integration.png"));
}
