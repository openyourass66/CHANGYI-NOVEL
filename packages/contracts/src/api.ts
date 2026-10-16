import type { ModelProvider, MemoryCategory, MemoryStatus } from "./domain";
import type { CitationRef, CitationView } from "./memory-view";

export type ProjectSummary = {
  id: string;
  name: string;
  language: string;
  genre: string | null;
  createdAt: string;
  updatedAt: string;
  chapterCount: number;
  sourceCount: number;
  memoryCount: number;
};

export type ProfileView = {
  id: string;
  name: string;
  provider: ModelProvider;
  model: string;
  baseUrl: string | null;
  isLocal: boolean;
  isDefault: boolean;
  hasKey: boolean;
  maskedKey: string | null;
  statusNote: string | null;
  lastCheckedAt: string | null;
  updatedAt: string;
};

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

export type ProposalKind = "add" | "update" | "conflict";

export type ProposalState = "pending" | "accepted" | "rejected" | "conflicted";

export type ProposalDraft = {
  category: MemoryCategory;
  key?: string;
  title?: string;
  content: string;
  status: MemoryStatus;
  citations: CitationRef[];
};

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

export type TaskScope = "chapter" | "project";

export type TaskSurface = "analysis" | "continuation";

export type RunPayload = {
  /** 章节范围（缺省＝全部）。 */
  chapterIds?: string[];
  /** 续写规划（章纲/草稿/连续性检查）。 */
  planId?: string;
  /** 单章草稿（生成/连续性检查/记忆增量）。 */
  draftId?: string;
  /** 仅生成该序号的章纲项。 */
  outlineIndex?: number;
  /** 章纲规划的目标章节数（缺省由任务决定）。 */
  outlineCount?: number;
};

export type TaskUnit = {
  id: string;
  label: string;
  /** 存在时，运行器会同步该章节的 analysisStatus。 */
  chapterId?: string;
};

export type TaskRequirement = "memory" | "plan" | "outline" | "drafts";

export type TaskSummary = {
  type: string;
  label: string;
  scope: TaskScope;
  unitLabel: string;
  description: string;
  requirement: TaskRequirement | null;
};

export type Progress = {
  batchIndex: number;
  batchTotal: number;
  unitsDone: number;
  unitsTotal: number;
  produced: number;
  errors: string[];
  /** 本次任务已处理的单元，用于中断后 resume 时避免重复处理（不影响新任务重跑）。 */
  doneIds: string[];
  /** 正在处理的单元，供前端显示「正在处理第 N 章…」；空闲时为 null。 */
  currentUnitId: string | null;
  currentLabel: string | null;
};

export type RunUnitView = {
  id: string;
  index: number;
  label: string;
  chapterId: string | null;
  status: string;
};

export type RunStatusView = {
  id: string;
  projectId: string;
  taskType: string;
  taskLabel: string;
  /** 单元量词（逐章＝章，整项目＝项）。 */
  unitLabel: string;
  /** pending | running | done | failed | canceled，另有视图层的 stalled（running 但处理器已失联）。 */
  status: string;
  progress: Progress;
  usage: ChatUsage;
  error: string | null;
  promptVersion: string | null;
  authorizedAt: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  payload: RunPayload;
  units: RunUnitView[];
};

export type RunPreview = {
  taskType: string;
  taskLabel: string;
  provider: string;
  providerLabel: string;
  model: string;
  isLocal: boolean;
  unitCount: number;
  unitLabel: string;
  totalChars: number;
  estimatedPromptChars: number;
  sampleText: string;
  note: string;
};
