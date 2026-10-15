import "server-only";
import { prisma } from "@/lib/db";
import { parseFlags } from "@/lib/chapters-view";

/**
 * 导出格式版本。v2 补齐了恢复所需的字段（章节/条目/方向/草稿的 id 与结构化列、
 * 问题证据、记忆提案）；恢复端同时兼容 v1（v1 缺少 id，引用无法回链，会按不可解析丢弃）。
 */
export const EXPORT_VERSION = 2;

/** 解析 JSON 字符串列；解析失败或为空时退回 fallback（不静默丢成空数组）。 */
function safeJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    const value = JSON.parse(text);
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/**
 * 项目数据快照。仅包含本项目内容，绝不含模型档案或任何密钥。
 */
export async function buildProjectExport(projectId: string) {
  const project = await prisma.novelProject.findUnique({
    where: { id: projectId },
    include: {
      sourceDocuments: { orderBy: { importedAt: "asc" } },
      chapters: { orderBy: { sortOrder: "asc" } },
      memoryEntries: { orderBy: [{ category: "asc" }, { createdAt: "asc" }] },
      characterKnowledge: { orderBy: { createdAt: "asc" } },
      continuityIssues: { orderBy: { createdAt: "asc" } },
      continuationPlans: { orderBy: { createdAt: "asc" } },
      draftChapters: { orderBy: { index: "asc" } },
      memoryProposals: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!project) throw new Error("项目不存在。");

  return {
    app: "novel-continuation",
    exportVersion: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      language: project.language,
      genre: project.genre,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    },
    sources: project.sourceDocuments.map((s) => ({
      fileName: s.fileName,
      format: s.format,
      contentHash: s.contentHash,
      encoding: s.encoding,
      byteSize: s.byteSize,
      importedAt: s.importedAt.toISOString(),
    })),
    chapters: project.chapters.map((c) => ({
      id: c.id,
      volumeNumber: c.volumeNumber,
      volumeTitle: c.volumeTitle,
      rawTitle: c.rawTitle,
      normalizedIndex: c.normalizedIndex,
      sortOrder: c.sortOrder,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      splitMethod: c.splitMethod,
      parseConfidence: c.parseConfidence,
      flags: parseFlags(c.flagsJson),
      analysisStatus: c.analysisStatus,
      content: c.content,
    })),
    memoryEntries: project.memoryEntries.map((m) => ({
      id: m.id,
      category: m.category,
      key: m.key,
      title: m.title,
      content: m.content,
      status: m.status,
      citations: safeJson(m.sourceCitationsJson, []),
      isUserEdited: m.isUserEdited,
      revision: m.revision,
      isCurrent: m.isCurrent,
      supersedesId: m.supersedesId,
    })),
    characterKnowledge: project.characterKnowledge.map((k) => ({
      characterName: k.characterName,
      infoItem: k.infoItem,
      relation: k.relation,
    })),
    continuityIssues: project.continuityIssues.map((i) => ({
      draftId: i.draftId,
      category: i.category,
      severity: i.severity,
      description: i.description,
      status: i.status,
      evidence: safeJson(i.evidenceJson, []),
    })),
    continuationPlans: project.continuationPlans.map((p) => ({
      id: p.id,
      direction: p.direction,
      summary: p.summary,
      status: p.status,
      version: p.version,
      outline: safeJson(p.outlineJson, []),
      relatedThreads: safeJson(p.relatedThreadsJson, []),
    })),
    draftChapters: project.draftChapters.map((d) => ({
      id: d.id,
      planId: d.planId,
      index: d.index,
      title: d.title,
      content: d.content,
      version: d.version,
      outlineItem: safeJson(d.outlineItemJson, {}),
      continuityCheck: safeJson(d.continuityCheckJson, {}),
      memoryUpdateStatus: d.memoryUpdateStatus,
    })),
    memoryProposals: project.memoryProposals.map((p) => ({
      chapterId: p.chapterId,
      draftId: p.draftId,
      kind: p.kind,
      category: p.category,
      key: p.key,
      title: p.title,
      content: p.content,
      status: p.status,
      citations: safeJson(p.citationsJson, []),
      targetEntryId: p.targetEntryId,
      reason: p.reason,
      state: p.state,
    })),
  };
}

/** 导出校对后正文（按 sortOrder 拼接章节），带 UTF-8 BOM 便于 Windows 记事本正确识别。 */
export async function buildSourceText(projectId: string): Promise<string> {
  const chapters = await prisma.chapter.findMany({
    where: { projectId },
    orderBy: { sortOrder: "asc" },
  });
  const parts: string[] = [];
  let currentVolume: string | null = null;
  for (const c of chapters) {
    if (c.volumeTitle && c.volumeTitle !== currentVolume) {
      currentVolume = c.volumeTitle;
      parts.push(`【${c.volumeTitle}】`);
    } else if (!c.volumeTitle) {
      currentVolume = null;
    }
    parts.push(`${c.rawTitle}\n\n${c.content}`.trimEnd());
  }
  const BOM = String.fromCharCode(0xfeff);
  return BOM + parts.join("\n\n\n") + "\n";
}

export function exportFileName(name: string, ext: string): string {
  const base = name.replace(/[\\/:*?"<>|\s-]+/g, "_").trim() || "project";
  return `${base.slice(0, 80)}.${ext}`;
}
