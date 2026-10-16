import { apiURL } from "./security.mjs";
const MAX_BYTES = 128 * 1024 * 1024;
export function service(vault, fetchImpl = fetch) {
  const bucket = () => {
    const server=vault.state.serverURL;
    if(!server) throw new Error("请先连接服务。");
    return vault.state.servers[server] ??= {cookies:{}, profiles:{}};
  };
  async function request(input) {
    const url = apiURL(vault.state.serverURL,input.path);
    if(!["GET","POST","PATCH","PUT","DELETE","HEAD"].includes(input.method) || (input.body?.byteLength ?? 0)>64*1024*1024) throw new Error("请求无效或上传文件过大。");
    const store=bucket();
    const headers={Origin:url.origin};
    for(const [key,value] of Object.entries(input.headers ?? {})) if(["content-type","accept"].includes(key.toLowerCase()) && typeof value === "string") headers[key]=value;
    const cookies=Object.entries(store.cookies).filter(([,c])=>c.expires>Date.now()&&(!c.secure||url.protocol==="https:")).map(([k,c])=>`${k}=${c.value}`).join("; ");
    if(cookies) headers.Cookie=cookies;
    let response;
    try { response=await fetchImpl(url,{method:input.method,headers,body:input.body ? Buffer.from(input.body) : undefined,redirect:"manual",signal:AbortSignal.timeout(url.pathname==="/api/v1/health"?8000:120_000)}); }
    catch { throw new Error("暂时无法连接服务，请检查网络或稍后重试。"); }
    if(response.status>=300&&response.status<400) throw new Error("服务连接发生异常，请稍后重试。");
    const setCookies=response.headers.getSetCookie();
    for(const line of setCookies){
      const [pair,...attrs]=line.split(";");const index=pair.indexOf("=");const name=pair.slice(0,index).trim();
      if(!/^(?:__Secure-)?better-auth\.(?:session_token|dont_remember)$/.test(name)) continue;
      const maxAge=attrs.find(a=>/^\s*max-age=/i.test(a))?.split("=")[1];
      const expires=attrs.find(a=>/^\s*expires=/i.test(a))?.slice(attrs.find(a=>/^\s*expires=/i.test(a)).indexOf("=")+1);
      const end=maxAge!==undefined?Date.now()+Number(maxAge)*1000:expires?Date.parse(expires):Date.now()+7*86400_000;
      if(end<=Date.now()||!pair.slice(index+1)) delete store.cookies[name];
      else store.cookies[name]={value:pair.slice(index+1),expires:end,secure:attrs.some(a=>a.trim().toLowerCase()==="secure")};
    }
    if(setCookies.length) await vault.save();
    const chunks=[];let bytes=0;
    if(response.body){for await(const chunk of response.body){bytes+=chunk.length;if(bytes>MAX_BYTES){await response.body.cancel().catch(()=>{});throw new Error("响应过大，请缩小导出范围。");}chunks.push(Buffer.from(chunk));}}
    let body=Buffer.concat(chunks);
    if(url.pathname.startsWith("/api/v1/auth/") && response.headers.get("content-type")?.includes("application/json")) {
      // 认证库部分响应包含原始会话 token；renderer 只需要用户和会话状态。
      body=Buffer.from(JSON.stringify(JSON.parse(body.toString()),(key,value)=>["token","accessToken","refreshToken"].includes(key)?undefined:value));
    }
    return {status:response.status,headers:[...response.headers].filter(([k])=>["content-type","content-disposition","retry-after"].includes(k.toLowerCase())),body:body.buffer.slice(body.byteOffset,body.byteOffset+body.byteLength)};
  }
  async function user(){
    const result=await request({path:"/api/v1/auth/get-session",method:"GET"});
    const data=JSON.parse(Buffer.from(result.body).toString());
    if(result.status!==200||!data?.user?.emailVerified||!data.user.id)throw new Error("请先登录并验证邮箱。");
    return data.user.id;
  }
  return {request,bucket,user};
}
