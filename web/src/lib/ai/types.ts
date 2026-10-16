export type { ChatRole, ChatMessage, ChatRequest, ChatUsage, ChatResult, ProposalKind, ProposalState, ProposalDraft, ProposalView } from "@contracts/api";
/** AI 适配层的纯类型。无 server-only 约束，便于在任务定义与运行器间共享。 */
import type { ModelProvider } from "@/lib/domain";











/** 运行时解析出的档案（含明文密钥），仅存在于服务端内存。 */
export type ResolvedProfile = {
  id: string;
  name: string;
  provider: ModelProvider;
  model: string;
  baseUrl: string | null;
  apiKey: string | null;
  isLocal: boolean;
  deviceOnly?: boolean;
};

export class AiError extends Error {
  readonly provider?: ModelProvider;
  readonly model?: string;
  readonly status?: number;

  constructor(
    message: string,
    opts: { provider?: ModelProvider; model?: string; status?: number } = {},
  ) {
    super(message);
    this.name = "AiError";
    this.provider = opts.provider;
    this.model = opts.model;
    this.status = opts.status;
  }
}

/** 结构化输出无法通过校验时抛出，保留原始文本以便记录与重试。 */
export class AiValidationError extends Error {
  readonly rawText: string;
  readonly detail: string;

  constructor(message: string, rawText: string, detail: string) {
    super(message);
    this.name = "AiValidationError";
    this.rawText = rawText;
    this.detail = detail;
  }
}
