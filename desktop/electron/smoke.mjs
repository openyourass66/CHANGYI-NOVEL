import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
export async function run(window,vault){
  const evaluate=code=>window.webContents.executeJavaScript(`(async()=>{${code}})()`);
  const screenshots=[];
  const capture=async name=>{
    try{const image=await window.webContents.capturePage();const file=path.join(process.env.CHANGYI_SMOKE_DATA,name);await writeFile(file,image.toPNG());screenshots.push(file);}
    catch(error){if(error?.message!=="UnknownVizError")throw error;console.warn("Smoke: 当前图形环境无法截屏，继续检查页面 DOM。");}
  };
  for(let i=0;i<100;i++){if(await evaluate('return document.body.innerText.includes("重试连接") && !!document.querySelector("input[type=email]");'))break;await new Promise(r=>setTimeout(r,100));}
  assert(await evaluate('return !!document.querySelector("input[type=email]");'),"首次启动直接展示登录页");
  assert(await evaluate('return !document.querySelector("input[type=url]") && !document.body.innerText.includes("更换服务");'),"界面不得要求用户配置服务器");
  assert.equal(await evaluate('return typeof window.changyi.configure;'),"undefined","没有修改服务器的原生接口");
  assert.equal(await evaluate('return (await window.changyi.configuration()).serverURL;'),undefined);
  assert(await evaluate('return document.body.innerText.includes("暂时无法连接服务");'),"服务故障提供简明提示");
  await capture("login.png");
  await evaluate('window.location.hash="#/login?mode=forgot";');
  for(let i=0;i<100;i++){if(await evaluate('return document.body.innerText.includes("找回密码") && !!document.querySelector("input[name=otp]");'))break;await new Promise(r=>setTimeout(r,100));}
  assert(await evaluate('const form=document.querySelector("form");return !!form && !!form.querySelector("input[name=email]") && !!form.querySelector("input[name=otp]") && !!form.querySelector("input[name=password]") && !!form.querySelector("input[name=confirmPassword]");'),"找回密码在同一表单显示邮箱、验证码和新密码");
  await evaluate('window.location.hash="#/login?mode=register";');
  for(let i=0;i<100;i++){if(await evaluate('return document.body.innerText.includes("创建账号") && !!document.querySelector("input[name=otp]");'))break;await new Promise(r=>setTimeout(r,100));}
  assert(await evaluate('const form=document.querySelector("form");return !!form && !!form.querySelector("input[name=email]") && !!form.querySelector("input[name=otp]");'),"注册在同一表单显示邮箱和验证码");
  await evaluate('window.location.hash="#/login";');
  for(let i=0;i<100;i++){if(await evaluate('return document.body.innerText.includes("密码登录");'))break;await new Promise(r=>setTimeout(r,100));}
  await evaluate('Array.from(document.querySelectorAll("button")).find(button=>button.textContent.includes("验证码登录")).click();');
  for(let i=0;i<100;i++){if(await evaluate('return !!document.querySelector("input[name=otp]");'))break;await new Promise(r=>setTimeout(r,100));}
  assert(await evaluate('const form=document.querySelector("form");return !!form && !!form.querySelector("input[name=email]") && !!form.querySelector("input[name=otp]");'),"验证码登录在同一表单显示邮箱和验证码");
  await evaluate('Array.from(document.querySelectorAll("button")).find(button=>button.textContent.includes("密码登录")).click();');
  await evaluate('await window.changyi.request({path:"/api/v1/test/ready",method:"GET",headers:{}});Array.from(document.querySelectorAll("button")).find(button=>button.textContent.includes("重试连接")).click();');
  for(let i=0;i<100;i++){if(await evaluate('return !document.body.innerText.includes("连接服务");'))break;await new Promise(r=>setTimeout(r,100));}
  assert(await evaluate('return !document.body.innerText.includes("暂时无法连接服务");'),"重试后自动恢复连接");
  assert.equal(await evaluate('return typeof require;'),"undefined","渲染进程不得拥有 Node require");
  assert.equal(await evaluate('return typeof window.changyi.request;'),"function");
  const base=process.env.CHANGYI_SMOKE_URL;
  const login=await evaluate('const r=await window.changyi.request({path:"/api/v1/auth/sign-in/email",method:"POST",headers:{"Content-Type":"application/json"},body:new TextEncoder().encode(JSON.stringify({email:"test@example.test",password:"smoke-password"})).buffer});return {headers:r.headers,body:new TextDecoder().decode(r.body)};');
  assert(!JSON.stringify(login).includes("private-smoke-token"),"原始会话不得返回 renderer");
  await evaluate('await window.changyi.saveLocalProfile("local-smoke",{provider:"ollama",model:"smoke-local",baseUrl:'+JSON.stringify(base+'/v1')+',apiKey:"private-local-smoke-key"});');
  const local=await evaluate('return await window.changyi.localProfile("local-smoke");');assert.equal(local.hasKey,true);assert(!JSON.stringify(local).includes("private-local-smoke-key"));
  const result=await evaluate('return await window.changyi.infer("smoke-inference","local-smoke",{messages:[{role:"user",content:"smoke"}]});');assert.equal(result.text,"LOCAL_OK");
  const encrypted=await readFile(path.join(process.env.CHANGYI_SMOKE_DATA,"credentials.bin"));
  for(const secret of ["native-private-smoke-token","private-local-smoke-key"])assert(!encrypted.includes(Buffer.from(secret)),"落盘凭据必须加密");
  const failure=await evaluate('try{await window.changyi.request({path:"https://untrusted.example",method:"GET"});return "";}catch(error){return error.message;}');
  assert(failure.includes("API 路径无效"));assert(!failure.includes("Error invoking")&&!failure.includes("changyi:request"),"界面不显示 Electron IPC 错误包装");
  const loaded=new Promise(resolve=>window.webContents.once("did-finish-load",resolve));window.webContents.reload();await loaded;
  for(let i=0;i<100;i++){if(await evaluate('return document.body.innerText.includes("新建项目");'))break;await new Promise(r=>setTimeout(r,100));}
  await capture("desktop.png");
  assert(await evaluate('return document.body.innerText.includes("新建项目");'),"打包页面通过持久会话加载项目库");
  assert(vault.state.servers[base].cookies["better-auth.session_token"]);
  console.log("PASS: fixed service target, same-page email/OTP forms, immediate login, no server editor/IPC setter, connection recovery, friendly IPC errors, sandbox, encrypted credentials, local inference."+(screenshots.length?" Screenshots: "+screenshots.join("; "):""));
}
