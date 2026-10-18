/** AI 适配层的纯类型。无 server-only 约束，便于在任务定义与运行器间共享。 */
import type { MemoryCategory, MemoryStatus, ModelProvider } from "@/lib/domain";
import type { CitationRef, CitationView } from "@/lib/memory-view";

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = { role: ChatRole; content: string };

export type ChatRequest = {
  messages: ChatMessage[];
  /** 覆盖档案中的模型名。 */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** 请求结构化 JSON 输出（供应商支持时启用 json 模式）。 */
  json?: boolean;
};

export type ChatUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type ChatResult = { text: string; usage: ChatUsage };

/** 运行时解析出的档案（含明文密钥），仅存在于服务端内存。 */
export type ResolvedProfile = {
  id: string;
  name: string;
  provider: ModelProvider;
  model: string;
  baseUrl: string | null;
  apiKey: string | null;
  isLocal: boolean;
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

/** 提案相对现有记忆的动作：新增 / 更新 / 冲突。 */
export type ProposalKind = "add" | "update" | "conflict";

export type ProposalState = "pending" | "accepted" | "rejected" | "conflicted";

/** 任务产出的提案草稿；kind/targetEntryId 由落库时依据现有记忆推断。 */
export type ProposalDraft = {
  category: MemoryCategory;
  key?: string;
  title?: string;
  content: string;
  status: MemoryStatus;
  citations: CitationRef[];
};

/** 提案的展示视图（出处已解析出章节标题与序）。 */
export type ProposalView = {
  id: string;
  runId: string | null;
  chapterId: string | null;
  /** 来源续写草稿；非空表示由草稿记忆增量产出。chapterId 与 draftId 不会同时非空。 */
  draftId: string | null;
  /** 来源草稿的可读标签（如「第 2 章 · 血旗」）；无来源草稿时为 null。 */
  draftLabel: string | null;
  kind: ProposalKind;
  category: MemoryCategory;
  key: string | null;
  title: string | null;
  content: string;
  status: MemoryStatus;
  citations: CitationView[];
  targetEntryId: string | null;
  reason: string | null;
  state: ProposalState;
  createdAt: string;
};
