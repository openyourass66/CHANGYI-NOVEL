import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  parseFlags,
  toSummary,
  type ChapterSummary,
  type ChapterView,
} from "@/lib/chapters-view";

export type { ChapterSummary, ChapterView };
export { parseFlags, toSummary };

export const chapterUpdateSchema = z.object({
  rawTitle: z.string().trim().min(1, "标题不能为空").max(200).optional(),
  normalizedIndex: z.number().int().min(0).max(100000).optional(),
});

export async function listChapterSummaries(
  projectId: string,
): Promise<ChapterSummary[]> {
  return (await listChapters(projectId)).map(toSummary);
}

type ChapterRow = Awaited<ReturnType<typeof prisma.chapter.findUnique>>;

function mapRow(c: NonNullable<ChapterRow>): ChapterView {
  return {
    id: c.id,
    volumeNumber: c.volumeNumber,
    volumeTitle: c.volumeTitle,
    rawTitle: c.rawTitle,
    normalizedIndex: c.normalizedIndex,
    sortOrder: c.sortOrder,
    content: c.content,
    charCount: c.content.length,
    splitMethod: c.splitMethod,
    parseConfidence: c.parseConfidence,
    flags: parseFlags(c.flagsJson),
    analysisStatus: c.analysisStatus,
  };
}

export async function listChapters(projectId: string): Promise<ChapterView[]> {
  const rows = await prisma.chapter.findMany({
    where: { projectId },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map(mapRow);
}

export async function getChapter(id: string) {
  return prisma.chapter.findUnique({ where: { id } });
}

export async function getChapterView(id: string): Promise<ChapterView | null> {
  const c = await getChapter(id);
  return c ? mapRow(c) : null;
}

export async function updateChapter(
  id: string,
  input: z.infer<typeof chapterUpdateSchema>,
): Promise<ChapterView> {
  const c = await prisma.chapter.update({
    where: { id },
    data: {
      rawTitle: input.rawTitle,
      normalizedIndex: input.normalizedIndex,
    },
  });
  return mapRow(c);
}

export async function deleteChapter(id: string) {
  const chapter = await prisma.chapter.findUnique({ where: { id } });
  if (!chapter) return;
  await prisma.$transaction(async (tx) => {
    await tx.chapter.delete({ where: { id } });
    await resequence(tx, chapter.projectId);
  });
}

async function resequence(
  tx: Pick<typeof prisma, "chapter">,
  projectId: string,
): Promise<void> {
  const rows = await tx.chapter.findMany({
    where: { projectId },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  for (let i = 0; i < rows.length; i++) {
    await tx.chapter.update({ where: { id: rows[i].id }, data: { sortOrder: i + 1 } });
  }
}

export async function reorderChapters(projectId: string, orderedIds: string[]) {
  const rows = await prisma.chapter.findMany({
    where: { projectId },
    select: { id: true },
  });
  const valid = new Set(rows.map((r) => r.id));
  const filtered = orderedIds.filter((id) => valid.has(id));
  if (filtered.length !== rows.length) {
    throw new Error("排序列表与项目章节不一致，请刷新后重试。");
  }
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < filtered.length; i++) {
      await tx.chapter.update({
        where: { id: filtered[i] },
        data: { sortOrder: i + 1 },
      });
    }
    await tx.novelProject.update({
      where: { id: projectId },
      data: { updatedAt: new Date() },
    });
  });
}

/** 在字符位置 atOffset 处拆分：前半保留，后半成为新章节。 */
export async function splitChapter(
  id: string,
  atOffset: number,
): Promise<ChapterSummary[]> {
  const chapter = await prisma.chapter.findUnique({ where: { id } });
  if (!chapter) throw new Error("章节不存在。");
  if (atOffset <= 0 || atOffset >= chapter.content.length) {
    throw new Error("拆分位置超出章节范围。");
  }
  const head = chapter.content.slice(0, atOffset).replace(/\s+$/, "");
  const tail = chapter.content.slice(atOffset).replace(/^\s+/, "");
  if (!head || !tail) throw new Error("拆分后存在空章节，请调整位置。");

  const newTitle = deriveTitle(tail) ?? `${chapter.rawTitle}（续）`;

  await prisma.$transaction(async (tx) => {
    const siblings = await tx.chapter.findMany({
      where: { projectId: chapter.projectId, sortOrder: { gt: chapter.sortOrder } },
      orderBy: { sortOrder: "asc" },
      select: { id: true, sortOrder: true },
    });
    // 为新章节腾出 sortOrder 空位
    for (const s of siblings.reverse()) {
      await tx.chapter.update({
        where: { id: s.id },
        data: { sortOrder: s.sortOrder + 1 },
      });
    }
    await tx.chapter.update({
      where: { id },
      data: {
        content: head,
        endOffset: chapter.startOffset + head.length,
        splitMethod: "manual",
        flagsJson: JSON.stringify(mergeFlags(parseFlags(chapter.flagsJson), ["manual-split"])),
      },
    });
    await tx.chapter.create({
      data: {
        projectId: chapter.projectId,
        sourceDocumentId: chapter.sourceDocumentId,
        volumeNumber: chapter.volumeNumber,
        volumeTitle: chapter.volumeTitle,
        rawTitle: newTitle,
        normalizedIndex: chapter.normalizedIndex,
        content: tail,
        startOffset: chapter.startOffset + head.length,
        endOffset: chapter.endOffset,
        sortOrder: chapter.sortOrder + 1,
        splitMethod: "manual",
        parseConfidence: chapter.parseConfidence,
        flagsJson: JSON.stringify(["manual-split"]),
      },
    });
    await tx.novelProject.update({
      where: { id: chapter.projectId },
      data: { updatedAt: new Date() },
    });
  });
  return listChapterSummaries(chapter.projectId);
}

/** 将 chapter 与紧随其后的 next 合并（next 内容并入 chapter，删除 next）。 */
export async function mergeChapters(
  id: string,
  nextId: string,
): Promise<ChapterSummary[]> {
  const [chapter, next] = await Promise.all([
    prisma.chapter.findUnique({ where: { id } }),
    prisma.chapter.findUnique({ where: { id: nextId } }),
  ]);
  if (!chapter || !next) throw new Error("章节不存在。");
  if (chapter.projectId !== next.projectId) throw new Error("不能跨项目合并。");

  const combined = `${chapter.content}\n\n${next.content}`.trim();

  await prisma.$transaction(async (tx) => {
    await tx.chapter.update({
      where: { id },
      data: {
        content: combined,
        endOffset: next.endOffset,
        splitMethod: "manual",
        flagsJson: JSON.stringify(mergeFlags(parseFlags(chapter.flagsJson), ["manual-split"])),
      },
    });
    await tx.chapter.delete({ where: { id: nextId } });
    await resequence(tx, chapter.projectId);
  });
  return listChapterSummaries(chapter.projectId);
}

function mergeFlags(base: string[], add: string[]): string[] {
  return [...new Set([...base, ...add])];
}

function deriveTitle(text: string): string | null {
  const firstLine = text.split("\n").find((l) => l.trim().length > 0)?.trim();
  if (!firstLine) return null;
  if (firstLine.length > 30) return null;
  return firstLine;
}
