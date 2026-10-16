import { localURL, validateChat } from "./security.mjs";
export function localModels(vault, api) {
  const controllers=new Map();
  async function profileKey(id){if(typeof id!=="string"||!/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw new Error("档案标识无效。");const origin=vault.state.serverURL;const userId=await api.user();if(origin!==vault.state.serverURL)throw new Error("服务连接已更换，请重试。");return `${userId}:${id}`;}
  return {
    async read(id){const p=api.bucket().profiles[await profileKey(id)];if(!p)return null;const {apiKey,...view}=p;return {...view,hasKey:Boolean(apiKey)};},
    async save(id,input){
      if(!["ollama","lmstudio","openai-compatible"].includes(input.provider)||typeof input.model!=="string"||!input.model.trim()||input.model.length>120||typeof input.apiKey!=="string"&&input.apiKey!==undefined||input.apiKey?.length>400)throw new Error("本地档案参数无效；请选择兼容 OpenAI 协议的本机模型。");
      const baseUrl=localURL(input.baseUrl,input.provider),key=await profileKey(id),store=api.bucket();
      store.profiles[key]={provider:input.provider,model:input.model.trim(),baseUrl,apiKey:input.apiKey?.trim()||store.profiles[key]?.apiKey||""}; await vault.save();
    },
    async remove(id){delete api.bucket().profiles[await profileKey(id)];await vault.save();},
    cancel(id){controllers.get(id)?.abort();},
    cancelAll(){for(const c of controllers.values())c.abort();},
    async infer(id,profileId,request){
      validateChat(request);
      if(typeof id!=="string"||id.length>128||controllers.has(id)||controllers.size>=2)throw new Error("本机模型繁忙或任务标识无效。");
      const controller=new AbortController();controllers.set(id,controller);
      const timer=setTimeout(()=>controller.abort(),120_000);
      try {
        const p=api.bucket().profiles[await profileKey(profileId)];if(!p)throw new Error("请先在当前设备的设置中保存并测试此本地模型档案。");
        const response=await fetch(`${localURL(p.baseUrl,p.provider)}/chat/completions`,{method:"POST",headers:{"Content-Type":"application/json",...(p.apiKey?{Authorization:`Bearer ${p.apiKey}`}:{})},body:JSON.stringify({model:p.model,messages:request.messages,temperature:request.temperature??0.2,...(request.maxTokens?{max_tokens:request.maxTokens}:{}),...(request.json?{response_format:{type:"json_object"}}:{})}),signal:controller.signal,redirect:"error"});
        if(!response.ok)throw new Error(`本机模型返回 HTTP ${response.status}。`);
        const text=await response.text();if(text.length>8_000_000)throw new Error("本机模型输出过大。");
        const data=JSON.parse(text),content=data.choices?.[0]?.message?.content;
        if(typeof content!=="string"||!content.trim())throw new Error("本机模型未返回有效内容。");
        const usage=data.usage??{};
        return {text:content,usage:{promptTokens:usage.prompt_tokens,completionTokens:usage.completion_tokens,totalTokens:usage.total_tokens}};
      } catch(error){if(controller.signal.aborted)throw new Error("本机模型请求已取消或超时。");throw new Error(error instanceof SyntaxError?"本机模型响应格式无效。":/^(本机模型|请先|服务连接已更换)/.test(error.message)?error.message:"无法连接本机模型，请检查 Ollama / LM Studio 是否已启动。");}
      finally{clearTimeout(timer);controllers.delete(id);}
    },
  };
}
