/** 出处定位：把模型给出的原文片段（excerpt）解析为可回链的字符偏移。纯函数，无 server-only。 */
import {
  MEMORY_CATEGORY_DEFAULT_STATUS,
  MEMORY_CATEGORY_STATUS,
  type MemoryCategory,
  type MemoryStatus,
} from "@/lib/domain";
import type { CitationRef } from "@/lib/memory-view";

/** 在文本中定位片段；依次尝试完整片段、前 60、前 30 字，容忍轻微差异。 */
export function locate(content: string, snippet: string): { start: number; end: number } | null {
  const candidates = [snippet, snippet.slice(0, 60), snippet.slice(0, 30)];
  for (const c of candidates) {
    const probe = c.trim();
    if (probe.length < 2) continue;
    const at = content.indexOf(probe);
    if (at >= 0) return { start: at, end: at + probe.length };
  }
  return null;
}

export function resolveCitation(
  chapter: { id: string; content: string },
  snippet: string,
): CitationRef | null {
  const found = locate(chapter.content, snippet);
  if (!found) return null;
  return {
    chapterId: chapter.id,
    startOffset: found.start,
    endOffset: found.end,
    excerpt: snippet.slice(0, 200),
  };
}

/** 在单个章节内解析多条片段，未命中的收入 unresolved（不静默丢弃）。 */
export function collect(
  chapter: { id: string; content: string },
  snippets: string[],
): { citations: CitationRef[]; unresolved: string[] } {
  const citations: CitationRef[] = [];
  const unresolved: string[] = [];
  for (const s of snippets) {
    const ref = resolveCitation(chapter, s);
    if (ref) citations.push(ref);
    else unresolved.push(s);
  }
  return { citations, unresolved };
}

/** 在多章范围（按给定顺序）内定位片段，用于非单章来源的任务（如全书统合）。 */
export function resolveAcrossChapters(
  chapters: Array<{ id: string; content: string }>,
  snippet: string,
): CitationRef | null {
  for (const chapter of chapters) {
    const ref = resolveCitation(chapter, snippet);
    if (ref) return ref;
  }
  return null;
}

/** 若状态不被该分类允许，退回该分类的默认状态（绝不把推断当作明述）。 */
export function clampStatus(category: MemoryCategory, status: MemoryStatus): MemoryStatus {
  return MEMORY_CATEGORY_STATUS[category].includes(status)
    ? status
    : MEMORY_CATEGORY_DEFAULT_STATUS[category];
}
