/** 领域枚举与展示标签。SQLite 不支持 enum，取值以字符串存储并集中在此定义。 */

export const ANALYSIS_STATUS = {
  pending: "待分析",
  analyzing: "分析中",
  done: "已完成",
  failed: "失败",
} as const;
export type AnalysisStatus = keyof typeof ANALYSIS_STATUS;

/** 一次分析任务的整体状态。stalled 为视图层状态（进程失联），DB 中仍是 running。 */
export const RUN_STATUS = {
  pending: "排队中",
  running: "进行中",
  stalled: "已中断",
  done: "已完成",
  failed: "失败",
  canceled: "已取消",
} as const;
export type RunStatus = keyof typeof RUN_STATUS;

export const MEMORY_CATEGORY = {
  "chapter-note": "章节笔记",
  "story-bible": "设定集",
  character: "人物",
  timeline: "时间线",
  thread: "悬念台账",
  style: "文风",
  glossary: "术语表",
  summary: "全书概要",
  outline: "续写大纲",
} as const;
export type MemoryCategory = keyof typeof MEMORY_CATEGORY;

export const MEMORY_STATUS = {
  confirmed: "明述",
  inferred: "推断",
  unknown: "未知",
  open: "未决",
  advanced: "推进中",
  resolved: "已回收",
  uncertain: "存疑",
} as const;
export type MemoryStatus = keyof typeof MEMORY_STATUS;

export const KNOWLEDGE_RELATION = {
  known: "已知",
  misbelieved: "误信",
  unknown: "未知",
} as const;
export type KnowledgeRelation = keyof typeof KNOWLEDGE_RELATION;

export const ISSUE_SEVERITY = {
  info: "提示",
  warning: "警告",
  error: "严重",
} as const;
export type IssueSeverity = keyof typeof ISSUE_SEVERITY;

export const ISSUE_STATUS = {
  open: "待处理",
  accepted: "已采纳",
  ignored: "已忽略",
  resolved: "已解决",
} as const;
export type IssueStatus = keyof typeof ISSUE_STATUS;

export const CHAPTER_FLAG = {
  "missing-number": "缺号",
  "duplicate-number": "重号",
  "out-of-order": "乱序",
  empty: "空章节",
  "uncertain-boundary": "切分存疑",
  "no-title": "无标题",
  "manual-split": "手工切分",
} as const;
export type ChapterFlag = keyof typeof CHAPTER_FLAG;

export const IMPORT_FORMAT = {
  txt: { label: "TXT 纯文本", ext: [".txt"], status: "supported" },
  markdown: { label: "Markdown", ext: [".md", ".markdown"], status: "supported" },
  docx: { label: "Word 文档", ext: [".docx"], status: "supported" },
  html: { label: "HTML 网页", ext: [".html", ".htm"], status: "supported" },
  epub: { label: "EPUB 电子书", ext: [".epub"], status: "supported" },
  pdf: {
    label: "PDF（文本型）",
    ext: [".pdf"],
    status: "supported",
    note: "仅支持可提取文本的 PDF；扫描版暂不支持 OCR。",
  },
} as const;
export type ImportFormat = keyof typeof IMPORT_FORMAT;

export const MODEL_PROVIDER = {
  "openai-compatible": "OpenAI 兼容接口",
  anthropic: "Anthropic",
  ollama: "Ollama（本地）",
  lmstudio: "LM Studio（本地）",
} as const;
export type ModelProvider = keyof typeof MODEL_PROVIDER;

/** 本地供应商不经云端，不发送原文或记忆到远端。 */
export const LOCAL_PROVIDERS: ModelProvider[] = ["ollama", "lmstudio"];

export type Tone =
  | "default"
  | "success"
  | "warning"
  | "info"
  | "destructive"
  | "muted";

export const MEMORY_STATUS_TONE: Record<string, Tone> = {
  confirmed: "success",
  inferred: "info",
  unknown: "muted",
  open: "warning",
  advanced: "info",
  resolved: "success",
  uncertain: "warning",
};

/** 各记忆分类允许的状态集合。推断（inferred）绝不可被当作明述（confirmed）。 */
export const MEMORY_CATEGORY_STATUS: Record<MemoryCategory, MemoryStatus[]> = {
  "chapter-note": ["confirmed", "inferred", "unknown"],
  "story-bible": ["confirmed", "inferred", "unknown"],
  character: ["confirmed", "inferred", "unknown"],
  timeline: ["confirmed", "inferred", "unknown"],
  thread: ["open", "advanced", "resolved", "uncertain"],
  style: ["confirmed", "inferred"],
  glossary: ["confirmed", "inferred", "unknown"],
  summary: ["confirmed", "inferred"],
  outline: ["confirmed", "inferred", "unknown"],
};

/** 新建条目时的默认状态。 */
export const MEMORY_CATEGORY_DEFAULT_STATUS: Record<MemoryCategory, MemoryStatus> = {
  "chapter-note": "unknown",
  "story-bible": "unknown",
  character: "unknown",
  timeline: "unknown",
  thread: "open",
  style: "inferred",
  glossary: "unknown",
  summary: "inferred",
  outline: "unknown",
};

export function isMemoryCategory(value: string): value is MemoryCategory {
  return value in MEMORY_CATEGORY;
}

export function isMemoryStatus(value: string): value is MemoryStatus {
  return value in MEMORY_STATUS;
}

export function formatLabel(format: string): string {
  return (IMPORT_FORMAT as Record<string, { label: string }>)[format]?.label ?? format;
}

/** 语义色调 → 徽标描边与文字色。用于状态、人物认知等标记。 */
export function toneClass(tone: Tone): string {
  switch (tone) {
    case "success":
      return "border-success/40 text-success";
    case "warning":
      return "border-warning/40 text-warning";
    case "info":
      return "border-info/40 text-info";
    case "destructive":
      return "border-destructive/40 text-destructive";
    case "muted":
      return "border-border text-muted-foreground";
    default:
      return "border-border text-foreground";
  }
}

export const KNOWLEDGE_RELATION_TONE: Record<KnowledgeRelation, Tone> = {
  known: "success",
  misbelieved: "warning",
  unknown: "muted",
};

export const RUN_STATUS_TONE: Record<string, Tone> = {
  pending: "muted",
  running: "info",
  stalled: "warning",
  done: "success",
  failed: "destructive",
  canceled: "muted",
};

export const ANALYSIS_STATUS_TONE: Record<string, Tone> = {
  pending: "muted",
  analyzing: "info",
  done: "success",
  failed: "destructive",
};

export function isValidFormat(format: string): format is ImportFormat {
  return format in IMPORT_FORMAT;
}
