import "server-only";
import { prisma } from "@/lib/db";
import { decodeBuffer } from "@/lib/import/parsers/encoding";
import { createKnowledge, listKnowledge } from "@/lib/knowledge";
import { createMemoryEntry, findCurrentEntryByKey, type MemoryInput } from "@/lib/memory";
import type { CitationRef } from "@/lib/memory-view";
import {
  parseMemoryDocument,
  type MemoryDocKind,
  type MemoryEntryDraft,
  type ParsedRef,
} from "./parse";

export type ImportFileInput = { fileName: string; buffer: Buffer };

export type FileImportResult = {
  fileName: string;
  kind: MemoryDocKind | null;
  imported: number;
  skipped: number;
  knowledge: number;
  warnings: string[];
  error?: string;
};

export type ImportSummary = {
  files: FileImportResult[];
  totals: { imported: number; skipped: number; knowledge: number };
};

type ChapterInfo = { id: string; title: string };

const MAX_CITATIONS = 50;

/**
 * 导入技能模板格式的记忆文档：解析 → 出处映射为章节 → 逐条写入。
 * 同一 (分类 + 键) 已有当前条目时跳过，绝不覆盖；导入条目视为人工内容（isUserEdited=true）。
 */
export async function importMemoryFiles(
  projectId: string,
  files: ImportFileInput[],
): Promise<ImportSummary> {
  const project = await prisma.novelProject.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) throw new Error("项目不存在。");

  const chapters = await prisma.chapter.findMany({
    where: { projectId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, rawTitle: true },
  });
  const byNumber = new Map<number, ChapterInfo>();
  chapters.forEach((c, i) => byNumber.set(i + 1, { id: c.id, title: c.rawTitle }));

  const knowledgeSeen = new Set(
    (await listKnowledge(projectId)).map((k) => `${k.characterName}::${k.infoItem}::${k.relation}`),
  );

  const results: FileImportResult[] = [];
  for (const file of files) {
    const result: FileImportResult = {
      fileName: file.fileName,
      kind: null,
      imported: 0,
      skipped: 0,
      knowledge: 0,
      warnings: [],
    };
    try {
      const { text } = decodeBuffer(file.buffer);
      const parsed = parseMemoryDocument(text, file.fileName);
      result.kind = parsed.kind;
      result.warnings.push(...parsed.warnings);
      if (!parsed.kind) {
        results.push(result);
        continue;
      }

      for (const draft of parsed.entries) {
        const { input, key } = toInput(draft, byNumber);
        const existing = await findCurrentEntryByKey(projectId, draft.category, key);
        if (existing) {
          result.skipped++;
          continue;
        }
        await createMemoryEntry(projectId, input);
        result.imported++;
      }

      for (const item of parsed.knowledge) {
        const identity = `${item.characterName}::${item.infoItem}::${item.relation}`;
        if (knowledgeSeen.has(identity)) continue;
        knowledgeSeen.add(identity);
        await createKnowledge(projectId, item);
        result.knowledge++;
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : "导入失败。";
    }
    results.push(result);
  }

  return {
    files: results,
    totals: {
      imported: results.reduce((n, r) => n + r.imported, 0),
      skipped: results.reduce((n, r) => n + r.skipped, 0),
      knowledge: results.reduce((n, r) => n + r.knowledge, 0),
    },
  };
}

/**
 * 把草稿转成写入输入：能对上项目的章节号变成出处徽标（偏移留空，供后续人工定位），
 * 对不上的章节号或带语义的注解回填正文，不静默丢弃。
 */
function toInput(
  draft: MemoryEntryDraft,
  byNumber: Map<number, ChapterInfo>,
): { input: MemoryInput; key: string } {
  const chapter = draft.chapterNumber != null ? byNumber.get(draft.chapterNumber) : undefined;
  const key = chapter ? `ch:${chapter.id}` : draft.key;

  const citations: CitationRef[] = [];
  const extras: string[] = [];
  const citedChapters = new Set<string>();
  const seenExtras = new Set<string>();

  const pushExtra = (value: string) => {
    const text = value.trim();
    if (!text || seenExtras.has(text)) return;
    seenExtras.add(text);
    extras.push(text);
  };

  for (const ref of draft.refs as ParsedRef[]) {
    let matched = false;
    for (const n of ref.numbers) {
      const info = byNumber.get(n);
      if (!info) {
        pushExtra(ref.raw);
        continue;
      }
      matched = true;
      if (citedChapters.has(info.id)) continue;
      citedChapters.add(info.id);
      citations.push({ chapterId: info.id, startOffset: 0, endOffset: 0, excerpt: "" });
    }
    if (ref.residual) pushExtra(ref.residual);
    else if (ref.numbers.length > 0 && !matched) pushExtra(ref.raw);
  }

  const content = extras.length > 0 ? `${draft.content}\n\n出处：${extras.join("；")}` : draft.content;

  return {
    key,
    input: {
      category: draft.category,
      key,
      title: draft.title,
      content,
      status: draft.status,
      citations: citations.slice(0, MAX_CITATIONS),
    },
  };
}
