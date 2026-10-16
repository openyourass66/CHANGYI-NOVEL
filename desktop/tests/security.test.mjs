import test from "node:test";
import assert from "node:assert/strict";
import {normalizeServerURL,apiURL,localURL,validateChat} from "../electron/security.mjs";
import {service} from "../electron/service.mjs";
import {localModels} from "../electron/local-model.mjs";
test("service and local model destinations are bounded",()=>{
  for(const value of ["http://example.com","https://name:password@example.com","https://example.com/path","file:///etc/passwd"])assert.throws(()=>normalizeServerURL(value));
  for(const value of ["https://example.com","http://127.0.0.1:3000","http://192.168.150.102:3000"])assert.equal(normalizeServerURL(value),value);
  for(const value of ["//other.example/api/v1/projects","/api/v1/../../other","/api/v1/%2e%2e/secret","/api/v1/projects#other","/api/projects"])assert.throws(()=>apiURL("https://example.com",value));
  assert.equal(apiURL("https://example.com","/api/v1/projects?query=abc").origin,"https://example.com");
  for(const value of ["http://10.0.0.1/v1","http://example.com/v1","http://localhost@evil.example/v1","file:///tmp/model"])assert.throws(()=>localURL(value,"ollama"));
  assert.equal(localURL("http://127.0.0.1:11434/v1/","ollama"),"http://127.0.0.1:11434/v1");
  assert.throws(()=>validateChat({messages:[{role:"tool",content:"x"}]}));
});
test("native cookies remain private, scoped, revocable, and redirects are refused",async()=>{
  const vault={state:{serverURL:"https://one.example",servers:{}},save:async()=>{}};
  let stage="login";
  const api=service(vault,async(url,options)=>{
    assert.equal(options.headers.Origin,url.origin);
    assert.equal(options.headers.Authorization,undefined);
    if(stage==="login")return Response.json({token:"private-session-token",user:{id:"u"}},{headers:{"Set-Cookie":"__Secure-better-auth.session_token=signed-private-token; Path=/; Max-Age=60; Secure; HttpOnly"}});
    if(stage==="other")assert.equal(options.headers.Cookie,undefined);else assert.equal(options.headers.Cookie,"__Secure-better-auth.session_token=signed-private-token");
    if(stage==="redirect")return new Response(null,{status:302,headers:{Location:"https://other.example"}});
    if(stage==="logout")return Response.json({success:true},{headers:{"Set-Cookie":"__Secure-better-auth.session_token=; Path=/; Max-Age=0"}});
    return Response.json({ok:true});
  });
  const input={path:"/api/v1/auth/sign-in/email",method:"POST",headers:{Authorization:"renderer-value",Cookie:"injected-cookie"}};
  const login=await api.request(input);
  assert(!Buffer.from(login.body).toString().includes("private-session-token"));
  assert(!JSON.stringify(login.headers).includes("signed-private-token"));
  stage="normal";await api.request({path:"/api/v1/projects",method:"GET"});
  stage="other";vault.state.serverURL="https://two.example";await api.request({path:"/api/v1/projects",method:"GET"});
  vault.state.serverURL="https://one.example";stage="redirect";await assert.rejects(api.request(input),/连接发生异常/);
  stage="logout";await api.request(input);assert.deepEqual(vault.state.servers["https://one.example"].cookies,{});
});
test("local concurrency slots are reserved before asynchronous account checks",async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const models=localModels({state:{serverURL:"https://example.com"}}, {user:async()=>{await gate;return "user";},bucket:()=>({profiles:{}})});
  const request={messages:[{role:"user",content:"test"}]};
  const first=assert.rejects(models.infer("one","profile",request),/请先/);
  const second=assert.rejects(models.infer("two","profile",request),/请先/);
  await assert.rejects(models.infer("three","profile",request),/繁忙/);
  release();await Promise.all([first,second]);
});
