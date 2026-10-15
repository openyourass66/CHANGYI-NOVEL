/** 章节视图类型与纯函数。无 server-only 约束，可同时被服务端与客户端引用。 */

export type ChapterView = {
  id: string;
  volumeNumber: number | null;
  volumeTitle: string | null;
  rawTitle: string;
  normalizedIndex: number;
  sortOrder: number;
  content: string;
  charCount: number;
  splitMethod: string;
  parseConfidence: number;
  flags: string[];
  analysisStatus: string;
};

/** 列表视图不含正文，正文按需单独获取，避免一次传输整本书。 */
export type ChapterSummary = Omit<ChapterView, "content">;

export function toSummary(chapter: ChapterView): ChapterSummary {
  return {
    id: chapter.id,
    volumeNumber: chapter.volumeNumber,
    volumeTitle: chapter.volumeTitle,
    rawTitle: chapter.rawTitle,
    normalizedIndex: chapter.normalizedIndex,
    sortOrder: chapter.sortOrder,
    charCount: chapter.charCount,
    splitMethod: chapter.splitMethod,
    parseConfidence: chapter.parseConfidence,
    flags: chapter.flags,
    analysisStatus: chapter.analysisStatus,
  };
}

export function parseFlags(flagsJson: string): string[] {
  try {
    const parsed = JSON.parse(flagsJson);
    return Array.isArray(parsed) ? parsed.filter((f) => typeof f === "string") : [];
  } catch {
    return [];
  }
}
