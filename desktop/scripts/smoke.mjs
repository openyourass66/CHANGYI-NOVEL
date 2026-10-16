import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
const profile=path.resolve(".verify",randomUUID());await mkdir(profile,{recursive:true});
const server=createServer(async(request,response)=>{
  const url=new URL(request.url,"http://localhost");
  response.setHeader("Content-Type","application/json");
  if(url.pathname==="/api/v1/auth/sign-in/email"){
    response.setHeader("Set-Cookie","better-auth.session_token=native-private-smoke-token; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600");
    response.end(JSON.stringify({token:"raw-private-smoke-token",user:{id:"smoke-user",name:"测试用户",email:"test@example.test",emailVerified:true}}));return;
  }
  const authenticated=request.headers.cookie?.includes("native-private-smoke-token");
  if(url.pathname==="/api/v1/auth/get-session"){response.end(JSON.stringify(authenticated?{user:{id:"smoke-user",name:"测试用户",email:"test@example.test",emailVerified:true},session:{id:"smoke-session",token:"raw-private-smoke-token",expiresAt:new Date(Date.now()+3600_000).toISOString()}}:null));return;}
  if(url.pathname==="/api/v1/device-inferences/claim"){response.end('{"job":null}');return;}
  if(url.pathname==="/api/v1/projects"&&authenticated){response.end('{"projects":[]}');return;}
  if(url.pathname==="/v1/chat/completions"){
    if(request.headers.cookie||request.headers.origin){response.statusCode=400;response.end('{}');return;}
    response.end(JSON.stringify({choices:[{message:{content:"LOCAL_OK"}}],usage:{total_tokens:3}}));return;
  }
  response.statusCode=404;response.end('{"error":"not found"}');
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
console.log("Smoke: isolated service ready.");
const env={...process.env,CHANGYI_SMOKE_DATA:profile,CHANGYI_SMOKE_URL:`http://127.0.0.1:${server.address().port}`};delete env.ELECTRON_RUN_AS_NODE;
const {default:electron}=await import("electron");
const child=spawn(electron,[".","--smoke"],{env,stdio:"inherit",windowsHide:true});
console.log("Smoke: Electron process requested.");
child.on("error",error=>{console.error(error.message);server.close();process.exitCode=1;});
const timeout=setTimeout(()=>{console.error("Smoke: Electron exceeded 60 seconds.");child.kill();},60_000);
const code=await new Promise(resolve=>child.once("exit",resolve));clearTimeout(timeout);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));process.exit(code??1);
