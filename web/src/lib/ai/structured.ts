import "server-only";
import type { z } from "zod";
import { runChat } from "@/lib/ai/client";
import {
  AiValidationError,
  type ChatMessage,
  type ChatUsage,
  type ResolvedProfile,
} from "@/lib/ai/types";

/** 从模型输出中抽取 JSON 主体，容忍代码围栏与前后废话。 */
export function extractJsonBlock(text: string): string {
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return t;
}

function tryParse<T>(
  raw: string,
  schema: z.ZodType<T>,
): { ok: true; data: T } | { ok: false; detail: string } {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonBlock(raw));
  } catch (error) {
    return { ok: false, detail: `JSON 解析失败：${error instanceof Error ? error.message : "未知"}` };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, data: parsed.data };
  const detail = parsed.error.issues
    .slice(0, 6)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("；");
  return { ok: false, detail };
}

/**
 * 请求结构化输出：提示模型仅返回 JSON，解析并校验；失败时携带校验错误重试一次。
 * 仍失败则抛 AiValidationError（保留原始文本）。
 */
export async function requestJson<T>(
  profile: ResolvedProfile,
  opts: {
    system: string;
    prompt: string;
    schema: z.ZodType<T>;
    maxTokens?: number;
  },
): Promise<{ data: T; usage: ChatUsage; raw: string }> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${opts.system}\n\n只输出一个 JSON 对象；不要输出解释、不要使用 Markdown 代码块。`,
    },
    { role: "user", content: opts.prompt },
  ];

  let raw = "";
  let detail = "未知";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await runChat(profile, {
      messages,
      json: true,
      temperature: 0.2,
      maxTokens: opts.maxTokens,
    });
    raw = res.text;
    const parsed = tryParse(raw, opts.schema);
    if (parsed.ok) return { data: parsed.data, usage: res.usage, raw };

    detail = parsed.detail;
    if (attempt === 0) {
      messages.push({ role: "assistant", content: raw.slice(0, 4000) });
      messages.push({
        role: "user",
        content: `上一次输出无法解析为合法 JSON 或结构不符：${detail}。请仅重新输出符合要求的 JSON 对象。`,
      });
    }
  }
  throw new AiValidationError("模型输出无法解析为符合结构的结果。", raw, detail);
}
