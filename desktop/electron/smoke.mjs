import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
export async function run(window,vault){
  const evaluate=code=>window.webContents.executeJavaScript(`(async()=>{${code}})()`);
  for(let i=0;i<100;i++){if(await evaluate('return document.body.innerText.includes("连接长忆服务");'))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(await evaluate('return typeof require;'),"undefined","渲染进程不得拥有 Node require");
  assert.equal(await evaluate('return typeof window.changyi.request;'),"function");
  const base=process.env.CHANGYI_SMOKE_URL;
  await evaluate(`await window.changyi.configure(${JSON.stringify(base)});`);
  const login=await evaluate('const r=await window.changyi.request({path:"/api/v1/auth/sign-in/email",method:"POST",headers:{"Content-Type":"application/json"},body:new TextEncoder().encode(JSON.stringify({email:"test@example.test",password:"smoke-password"})).buffer});return {headers:r.headers,body:new TextDecoder().decode(r.body)};');
  assert(!JSON.stringify(login).includes("private-smoke-token"),"原始会话不得返回 renderer");
  await evaluate('await window.changyi.saveLocalProfile("local-smoke",{provider:"ollama",model:"smoke-local",baseUrl:'+JSON.stringify(base+'/v1')+',apiKey:"private-local-smoke-key"});');
  const local=await evaluate('return await window.changyi.localProfile("local-smoke");');assert.equal(local.hasKey,true);assert(!JSON.stringify(local).includes("private-local-smoke-key"));
  const result=await evaluate('return await window.changyi.infer("smoke-inference","local-smoke",{messages:[{role:"user",content:"smoke"}]});');assert.equal(result.text,"LOCAL_OK");
  const encrypted=await readFile(path.join(process.env.CHANGYI_SMOKE_DATA,"credentials.bin"));
  for(const secret of ["native-private-smoke-token","private-local-smoke-key"])assert(!encrypted.includes(Buffer.from(secret)),"落盘凭据必须加密");
  assert.equal(await evaluate('try{await window.changyi.request({path:"https://untrusted.example",method:"GET"});return false;}catch{return true;}'),true);
  const loaded=new Promise(resolve=>window.webContents.once("did-finish-load",resolve));window.webContents.reload();await loaded;
  for(let i=0;i<100;i++){if(await evaluate('return document.body.innerText.includes("新建项目");'))break;await new Promise(r=>setTimeout(r,100));}
  const image=await window.webContents.capturePage();await writeFile(path.join(process.env.CHANGYI_SMOKE_DATA,"desktop.png"),image.toPNG());
  assert(await evaluate('return document.body.innerText.includes("新建项目");'),"打包页面通过持久会话加载项目库");
  assert(vault.state.servers[base].cookies["better-auth.session_token"]);
  console.log("PASS: packaged UI, sandbox, encrypted native session/local secrets, authenticated API, bounded local inference, navigation. Screenshot: "+path.join(process.env.CHANGYI_SMOKE_DATA,"desktop.png"));
}
