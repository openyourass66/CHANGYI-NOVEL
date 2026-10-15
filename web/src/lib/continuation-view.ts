/** 续写规划的视图类型与纯解析函数。无 server-only 约束，客户端可安全引用。 */
import type { IssueSeverity, IssueStatus, Tone } from "@/lib/domain";

/** 证据引用：可指向原文章节、记忆条目或（连续性检查时的）草稿正文。 */
export type EvidenceRef = {
  kind: "chapter" | "memory" | "draft";
  chapterId?: string;
  entryId?: string;
  draftId?: string;
  startOffset?: number;
  endOffset?: number;
  excerpt?: string;
};

export type OutlineItem = {
  index: number;
  title: string;
  summary: string;
  beats: string[];
  relatedThreads: string[];
};

export type PlanStatus = "draft" | "active" | "done";

export type ContinuationPlanView = {
  id: string;
  projectId: string;
  direction: string;
  summary: string | null;
  outline: OutlineItem[];
  relatedThreads: string[];
  status: PlanStatus;
  version: number;
  draftCount: number;
  createdAt: string;
  updatedAt: string;
};

export type MemoryUpdateStatus = "none" | "proposed" | "applied";

export type DraftChapterView = {
  id: string;
  projectId: string;
  planId: string | null;
  index: number;
  title: string | null;
  content: string;
  outlineItem: OutlineItem | null;
  version: number;
  memoryUpdateStatus: MemoryUpdateStatus;
  /** 上一次连续性检查完成的时间；从未检查过为 null。 */
  continuityCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** 连续性检查产出的问题。draftId 非空表示由某一章草稿的检查产出。 */
export type ContinuityIssueView = {
  id: string;
  projectId: string;
  draftId: string | null;
  category: string;
  severity: IssueSeverity;
  description: string;
  evidence: EvidenceRef[];
  status: IssueStatus;
  createdAt: string;
  updatedAt: string;
};

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  draft: "候选方向",
  active: "已选定",
  done: "已完成",
};

export const PLAN_STATUS_TONE: Record<PlanStatus, Tone> = {
  draft: "muted",
  active: "success",
  done: "info",
};

export const MEMORY_UPDATE_LABEL: Record<MemoryUpdateStatus, string> = {
  none: "未处理",
  proposed: "有记忆提案",
  applied: "记忆已更新",
};

export const MEMORY_UPDATE_TONE: Record<MemoryUpdateStatus, Tone> = {
  none: "muted",
  proposed: "warning",
  applied: "success",
};

/** 连续性问题的类别。沿用 DB 中存储的中文类别名。 */
export const ISSUE_CATEGORY = {
  时间: "时间",
  因果: "因果",
  设定: "设定",
  "人物认知": "人物认知",
  视角: "视角",
  顺序: "顺序",
  其他: "其他",
} as const;
export type IssueCategory = keyof typeof ISSUE_CATEGORY;

export const ISSUE_CATEGORY_TONE: Record<string, Tone> = {
  时间: "warning",
  因果: "destructive",
  设定: "destructive",
  人物认知: "warning",
  视角: "info",
  顺序: "info",
  其他: "muted",
};

export const ISSUE_SEVERITY_TONE: Record<IssueSeverity, Tone> = {
  info: "info",
  warning: "warning",
  error: "destructive",
};

export const ISSUE_STATUS_TONE: Record<IssueStatus, Tone> = {
  open: "warning",
  accepted: "info",
  ignored: "muted",
  resolved: "success",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function toOutlineItem(value: unknown, fallbackIndex: number): OutlineItem | null {
  if (!isRecord(value)) return null;
  const title = typeof value.title === "string" ? value.title : "";
  if (!title.trim()) return null;
  const rawIndex = value.index;
  return {
    index: typeof rawIndex === "number" && Number.isFinite(rawIndex) ? rawIndex : fallbackIndex,
    title,
    summary: typeof value.summary === "string" ? value.summary : "",
    beats: toStringArray(value.beats),
    relatedThreads: toStringArray(value.relatedThreads),
  };
}

export function parseOutline(json: string | null | undefined): OutlineItem[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const items: OutlineItem[] = [];
  parsed.forEach((raw, i) => {
    const item = toOutlineItem(raw, i + 1);
    if (item) items.push(item);
  });
  return items;
}

export function parseOutlineItem(json: string | null | undefined): OutlineItem | null {
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  return toOutlineItem(parsed, 1);
}

export function parseEvidence(json: string | null | undefined): EvidenceRef[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((e): e is EvidenceRef => {
    if (!isRecord(e)) return false;
    return e.kind === "chapter" || e.kind === "memory" || e.kind === "draft";
  });
}

export function parseStringArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    return toStringArray(JSON.parse(json));
  } catch {
    return [];
  }
}

export function isPlanStatus(value: string): value is PlanStatus {
  return value === "draft" || value === "active" || value === "done";
}

export function isIssueStatus(value: string): value is IssueStatus {
  return value === "open" || value === "accepted" || value === "ignored" || value === "resolved";
}

export function isIssueSeverity(value: string): value is IssueSeverity {
  return value === "info" || value === "warning" || value === "error";
}
