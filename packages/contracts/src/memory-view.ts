/** 记忆与认知的视图类型及纯函数。无 server-only 约束，客户端可安全引用。 */
import type { KnowledgeRelation, MemoryCategory, MemoryStatus } from "./domain";

export type CitationRef = {
  chapterId: string;
  startOffset: number;
  endOffset: number;
  excerpt: string;
};

/** 出处视图：附带章节标题与序号，便于无跳转即可辨认来源。 */
export type CitationView = CitationRef & {
  chapterTitle: string;
  chapterIndex: number;
};

export type MemoryEntryView = {
  id: string;
  category: MemoryCategory;
  key: string | null;
  title: string | null;
  content: string;
  status: MemoryStatus;
  citations: CitationView[];
  isUserEdited: boolean;
  revision: number;
  supersedesId: string | null;
  updatedAt: string;
};

export type KeyConflict = {
  category: MemoryCategory;
  key: string;
  entries: MemoryEntryView[];
};

export type KnowledgeView = {
  id: string;
  characterName: string;
  infoItem: string;
  relation: KnowledgeRelation;
  createdAt: string;
};

export function parseCitations(json: string): CitationRef[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is CitationRef =>
        c &&
        typeof c.chapterId === "string" &&
        typeof c.startOffset === "number" &&
        typeof c.endOffset === "number" &&
        typeof c.excerpt === "string",
    );
  } catch {
    return [];
  }
}
