import "server-only";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { LOCAL_PROVIDERS, type ModelProvider } from "@/lib/domain";
import {
  AiError,
  type ChatRequest,
  type ChatResult,
  type ChatUsage,
  type ResolvedProfile,
} from "@/lib/ai/types";

/**
 * 本地供应商缺省地址。本地与云端共用同一实现，仅密钥与地址不同；
 * 本地端点连接失败时**直接报错，绝不静默回退到云端**（保持数据不外发）。
 */
const DEFAULT_BASE_URLS: Partial<Record<ModelProvider, string>> = {
  ollama: "http://localhost:11434/v1",
  lmstudio: "http://localhost:1234/v1",
};

const DEFAULT_TIMEOUT_MS = 120_000;

function resolveBaseUrl(profile: ResolvedProfile): string {
  const url = profile.baseUrl?.trim() || DEFAULT_BASE_URLS[profile.provider];
  if (!url) {
    throw new AiError("该档案未配置服务地址（baseUrl）。", {
      provider: profile.provider,
      model: profile.model,
    });
  }
  return url.replace(/\/+$/, "");
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  profile: ResolvedProfile,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new AiError(`模型接口返回 ${res.status}：${text.slice(0, 300)}`, {
        provider: profile.provider,
        model: profile.model,
        status: res.status,
      });
    }
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AiError(`模型请求超时（>${Math.round(DEFAULT_TIMEOUT_MS / 1000)}s）。`, {
        provider: profile.provider,
        model: profile.model,
      });
    }
    throw new AiError(`无法连接模型接口：${error instanceof Error ? error.message : "未知错误"}`, {
      provider: profile.provider,
      model: profile.model,
    });
  } finally {
    clearTimeout(timer);
  }
}

function mapUsage(usage: unknown): ChatUsage {
  const u = (usage ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  return {
    promptTokens: num(u.prompt_tokens),
    completionTokens: num(u.completion_tokens),
    totalTokens: num(u.total_tokens),
  };
}

/** OpenAI 兼容接口：OpenAI 官方、DeepSeek、通义，以及 Ollama / LM Studio 的 /v1 端点。 */
async function runOpenAiCompatible(
  profile: ResolvedProfile,
  request: ChatRequest,
): Promise<ChatResult> {
  const base = resolveBaseUrl(profile);
  const headers: Record<string, string> = {};
  if (profile.apiKey) headers.Authorization = `Bearer ${profile.apiKey}`;

  const body: Record<string, unknown> = {
    model: request.model ?? profile.model,
    messages: request.messages,
    temperature: request.temperature ?? 0.2,
  };
  if (request.maxTokens) body.max_tokens = request.maxTokens;
  if (request.json) body.response_format = { type: "json_object" };

  const data = await postJson(`${base}/chat/completions`, headers, body, profile);
  const choices = data.choices as Array<{ message?: { content?: unknown } }> | undefined;
  const text = choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new AiError("模型响应缺少内容。", { provider: profile.provider, model: profile.model });
  }
  return { text, usage: mapUsage(data.usage) };
}

/** Anthropic Messages API。 */
async function runAnthropic(
  profile: ResolvedProfile,
  request: ChatRequest,
): Promise<ChatResult> {
  const base = (profile.baseUrl?.trim() || "https://api.anthropic.com").replace(/\/+$/, "");
  const system = request.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const messages = request.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const headers: Record<string, string> = {
    "x-api-key": profile.apiKey ?? "",
    "anthropic-version": "2023-06-01",
  };
  const body: Record<string, unknown> = {
    model: request.model ?? profile.model,
    max_tokens: request.maxTokens ?? 4096,
    messages,
    temperature: request.temperature ?? 0.2,
  };
  if (system) body.system = system;

  const data = await postJson(`${base}/v1/messages`, headers, body, profile);
  const blocks = data.content as Array<{ type?: string; text?: string }> | undefined;
  const text = Array.isArray(blocks)
    ? blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("")
    : "";
  if (!text.trim()) {
    throw new AiError("模型响应缺少内容。", { provider: profile.provider, model: profile.model });
  }
  const usage = data.usage as Record<string, unknown> | undefined;
  return {
    text,
    usage: {
      promptTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined,
      completionTokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined,
    },
  };
}

export async function runChat(
  profile: ResolvedProfile,
  request: ChatRequest,
): Promise<ChatResult> {
  switch (profile.provider) {
    case "anthropic":
      return runAnthropic(profile, request);
    case "openai-compatible":
    case "ollama":
    case "lmstudio":
      return runOpenAiCompatible(profile, request);
    default:
      throw new AiError(`不支持的供应商：${profile.provider}`);
  }
}

/** 从数据库档案解析出运行时档案（含明文密钥）。仅服务端调用。 */
export async function resolveProfile(profileId: string): Promise<ResolvedProfile> {
  const row = await prisma.modelProfile.findUnique({ where: { id: profileId } });
  if (!row) throw new AiError("模型档案不存在。");
  let apiKey: string | null = null;
  if (row.apiKeyEncrypted) {
    try {
      apiKey = decryptSecret(row.apiKeyEncrypted);
    } catch {
      throw new AiError("密钥无法解密，请重新保存该档案的密钥。");
    }
  }
  return {
    id: row.id,
    name: row.name,
    provider: row.provider as ModelProvider,
    model: row.model,
    baseUrl: row.baseUrl,
    apiKey,
    isLocal: row.isLocal || LOCAL_PROVIDERS.includes(row.provider as ModelProvider),
  };
}
