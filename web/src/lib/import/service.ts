import "server-only";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import {
  ensureProjectDirs,
  fromStoredPath,
  projectSourcesDir,
  toStoredPath,
} from "@/lib/storage";
import { formatLabel } from "@/lib/domain";
import { detectChapters, fallbackSingleChapter, type ParseStats } from "./chapter-detect";
import { parseDocument } from "./parsers";

export type ImportResult = {
  sourceDocumentId: string;
  format: string;
  formatLabel: string;
  encoding: string | null;
  contentHash: string;
  fileName: string;
  byteSize: number;
  chapterCount: number;
  stats: ParseStats;
  warnings: string[];
  preview: { index: number; title: string; chars: number; flags: string[] }[];
};

function safeFileName(name: string): string {
  return path.basename(name).replace(/[^\w.\-一-龥]+/g, "_").slice(0, 120) || "source";
}

export async function importSource(
  projectId: string,
  fileName: string,
  buffer: Buffer,
): Promise<ImportResult> {
  const project = await prisma.novelProject.findUnique({ where: { id: projectId } });
  if (!project) throw new Error("项目不存在。");

  const outcome = await parseDocument(buffer, fileName);
  if (!outcome.ok) throw new Error(outcome.error);
  const { format, doc } = outcome;

  const contentHash = createHash("sha256").update(buffer).digest("hex");

  const detected = detectChapters(doc.text);
  const chapters =
    detected.chapters.length > 0 ? detected.chapters : fallbackSingleChapter(doc.text);

  const activeRun = await prisma.analysisRun.findFirst({
    where: { projectId, status: { in: ["pending", "running"] } },
    select: { id: true },
  });
  if (activeRun) {
    throw new Error("项目仍有分析任务运行中，请先取消或等待任务结束后再重新导入。");
  }

  await ensureProjectDirs(projectId);
  const dir = projectSourcesDir(projectId);
  await mkdir(dir, { recursive: true });
  const targetName = `${contentHash.slice(0, 12)}-${safeFileName(fileName)}`;
  const absolutePath = path.join(dir, targetName);
  await writeFile(absolutePath, buffer);

  const storedPath = toStoredPath(absolutePath);

  // 记录旧文件路径以便清理（本项目“单源文”语义：重新导入即替换）
  const previous = await prisma.sourceDocument.findMany({ where: { projectId } });
  const previousPaths = previous.map((p) => p.storedPath);

  const result = await prisma.$transaction(async (tx) => {
    // 正在运行的任务可能在导入完成后继续写入旧原文的分析结果；必须先让用户取消/等待。
    const activeRun = await tx.analysisRun.findFirst({
      where: { projectId, status: { in: ["pending", "running"] } },
      select: { id: true },
    });
    if (activeRun) {
      throw new Error("项目仍有分析任务运行中，请先取消或等待任务结束后再重新导入。");
    }

    // 新原文会使所有依赖旧章节的分析和续写产物失去依据，随旧章节一并清理。
    // 草稿和问题先删，避免计划删除时 draft 的 SetNull 关系留下孤立草稿。
    await tx.memoryProposal.deleteMany({ where: { projectId } });
    await tx.continuityIssue.deleteMany({ where: { projectId } });
    await tx.draftChapter.deleteMany({ where: { projectId } });
    await tx.continuationPlan.deleteMany({ where: { projectId } });
    await tx.memoryEntry.deleteMany({ where: { projectId } });
    await tx.characterKnowledge.deleteMany({ where: { projectId } });
    await tx.analysisRun.deleteMany({ where: { projectId } });
    await tx.chapter.deleteMany({ where: { projectId } });
    await tx.sourceDocument.deleteMany({ where: { projectId } });

    const source = await tx.sourceDocument.create({
      data: {
        projectId,
        fileName,
        format,
        storedPath,
        contentHash,
        encoding: doc.encoding ?? null,
        byteSize: buffer.byteLength,
      },
    });

    for (let i = 0; i < chapters.length; i++) {
      const c = chapters[i];
      await tx.chapter.create({
        data: {
          projectId,
          sourceDocumentId: source.id,
          volumeNumber: c.volumeNumber,
          volumeTitle: c.volumeTitle,
          rawTitle: c.rawTitle,
          normalizedIndex: c.normalizedIndex,
          content: c.content,
          startOffset: c.startOffset,
          endOffset: c.endOffset,
          sortOrder: i + 1,
          splitMethod: "auto",
          parseConfidence: c.confidence,
          flagsJson: JSON.stringify(c.flags),
        },
      });
    }

    await tx.novelProject.update({
      where: { id: projectId },
      data: { updatedAt: new Date() },
    });

    return source;
  }).catch(async (error: unknown) => {
    // 事务被拒绝（例如仍有分析任务运行）时，清掉刚写入但未入库的新源文件。
    if (!previousPaths.includes(storedPath)) {
      await rm(absolutePath, { force: true }).catch(() => {});
    }
    throw error;
  });

  // 清理被替换的旧文件
  for (const p of previousPaths) {
    if (p === storedPath) continue;
    await rm(fromStoredPath(p), { force: true }).catch(() => {});
  }

  const stats: ParseStats = {
    ...detected.stats,
    total: chapters.length,
  };

  return {
    sourceDocumentId: result.id,
    format,
    formatLabel: formatLabel(format),
    encoding: doc.encoding ?? null,
    contentHash,
    fileName,
    byteSize: buffer.byteLength,
    chapterCount: chapters.length,
    stats,
    warnings: doc.warnings,
    preview: chapters.map((c, i) => ({
      index: i + 1,
      title: c.rawTitle,
      chars: c.content.length,
      flags: c.flags,
    })),
  };
}
