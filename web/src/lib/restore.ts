import "server-only";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth-session";
import { ensureProjectDirs, projectDir, projectSourcesDir, toStoredPath } from "@/lib/storage";
import { EXPORT_VERSION } from "@/lib/export";

export type RestoreSummary = {
  projectId: string;
  projectName: string;
  chapterCount: number;
  memoryCount: number;
  knowledgeCount: number;
  planCount: number;
  draftCount: number;
  issueCount: number;
  proposalCount: number;
  /** 因源备份缺少 id 或已删除而无法回链、被丢弃的引用条数（v1 备份常见）。 */
  droppedCitations: number;
};

function badRequest(message: string, status = 400): Error {
  const error = new Error(message);
  (error as { status?: number }).status = status;
  return error;
}

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clip(value: unknown, fallback: string, max: number): string {
  const text = str(value, fallback);
  return text.slice(0, max) || fallback;
}

/** 恢复到一个新项目，避免覆盖现有项目。重名时追加「（恢复）」后缀。 */
async function uniqueProjectName(base: string): Promise<string> {
  const user = await requireUser();
  const taken = new Set(
    (await prisma.novelProject.findMany({ where: { ownerId: user.id }, select: { name: true } })).map((p) => p.name),
  );
  if (!taken.has(base)) return base;
  let candidate = `${base}（恢复）`;
  let n = 2;
  while (taken.has(candidate)) candidate = `${base}（恢复 ${n++}）`;
  return candidate;
}

function safeSourceName(name: string): string {
  return path.basename(name).replace(/[^\w.\-一-龥]+/g, "_").slice(0, 120) || "source";
}

/**
 * 从备份 JSON 恢复出一个新项目。原始源文件不在备份内，因此按章节正文拼接合成一份只读原文，
 * 章节仍沿用导出的字符偏移与顺序；记忆引用、草稿证据等一律重映射到新生成的 id。
 */
export async function restoreProjectFromExport(input: unknown): Promise<RestoreSummary> {
  const user = await requireUser();
  const root = asObject(input);
  if (!root) throw badRequest("备份文件格式不正确（不是 JSON 对象）。");
  if (root.app !== undefined && root.app !== "novel-continuation") {
    throw badRequest("这不是本应用导出的备份文件。");
  }
  const version = num(root.exportVersion, 0);
  if (version !== 1 && version !== EXPORT_VERSION) {
    throw badRequest(`不支持的备份版本：${root.exportVersion ?? "未知"}。`);
  }

  const projectMeta = asObject(root.project);
  const baseName = str(projectMeta?.name).trim();
  if (!baseName) throw badRequest("备份文件缺少项目名称。");

  const chapterRows = asArray(root.chapters).map((c) => asObject(c) ?? {});
  const contentParts = chapterRows.map((c) => str(c.content));
  const concatenated = contentParts.join("\n\n");

  const name = await uniqueProjectName(baseName);
  const project = await prisma.novelProject.create({
    data: {
      ownerId: user.id,
      name,
      language: clip(projectMeta?.language, "zh", 20),
      genre: strOrNull(projectMeta?.genre),
    },
  });

  try {
    await ensureProjectDirs(project.id);

    let storedPath: string | null = null;
    let contentHash: string | null = null;
    let byteSize = 0;
    const firstSource = asObject(asArray(root.sources)[0]);
    if (chapterRows.length > 0) {
      contentHash = createHash("sha256").update(concatenated, "utf8").digest("hex");
      const buffer = Buffer.from(concatenated, "utf8");
      byteSize = buffer.byteLength;
      const dir = projectSourcesDir(project.id);
      await mkdir(dir, { recursive: true });
      const fileName = safeSourceName(str(firstSource?.fileName, `${name}.txt`));
      const absolute = path.join(dir, `${contentHash.slice(0, 12)}-${fileName}`);
      await writeFile(absolute, buffer);
      storedPath = toStoredPath(absolute);
    }

    return await prisma.$transaction(
      async (tx) => {
        const chapterMap = new Map<string, string>();
        const entryMap = new Map<string, string>();
        const planMap = new Map<string, string>();
        const draftMap = new Map<string, string>();
        let droppedCitations = 0;

        const source =
          storedPath && contentHash
            ? await tx.sourceDocument.create({
                data: {
                  projectId: project.id,
                  fileName: str(firstSource?.fileName, `${name}.txt`),
                  format: clip(firstSource?.format, "txt", 20),
                  storedPath,
                  contentHash,
                  encoding: strOrNull(firstSource?.encoding),
                  byteSize,
                },
              })
            : null;

        // 章节：保留原顺序与偏移（拆分/合并依赖它们，与源文无关）。
        let cursor = 0;
        for (let i = 0; i < chapterRows.length; i++) {
          const c = chapterRows[i];
          const content = contentParts[i];
          const startOffset = num(c.startOffset, cursor);
          const endOffset = num(c.endOffset, startOffset + content.length);
          cursor = endOffset + 2;
          const created = await tx.chapter.create({
            data: {
              projectId: project.id,
              sourceDocumentId: source?.id ?? "",
              volumeNumber: typeof c.volumeNumber === "number" ? c.volumeNumber : null,
              volumeTitle: strOrNull(c.volumeTitle),
              rawTitle: clip(c.rawTitle, `第 ${i + 1} 章`, 300),
              normalizedIndex: num(c.normalizedIndex, i + 1),
              content,
              startOffset,
              endOffset,
              sortOrder: num(c.sortOrder, i + 1),
              splitMethod: clip(c.splitMethod, "auto", 20),
              parseConfidence: num(c.parseConfidence, 1),
              flagsJson: JSON.stringify(asArray(c.flags)),
              analysisStatus: clip(c.analysisStatus, "pending", 20),
            },
          });
          const oldId = strOrNull(c.id);
          if (oldId) chapterMap.set(oldId, created.id);
        }

        /** 记忆引用回链到恢复后的章节；源备份缺 id（v1）或章节已删除时丢弃该条引用。 */
        const remapCitations = (value: unknown): string => {
          const out: unknown[] = [];
          for (const item of asArray(value)) {
            const ref = asObject(item);
            const old = ref ? strOrNull(ref.chapterId) : null;
            const mapped = old ? chapterMap.get(old) : undefined;
            if (!ref || !mapped) {
              droppedCitations += 1;
              continue;
            }
            out.push({ ...ref, chapterId: mapped });
          }
          return JSON.stringify(out);
        };

        const memoryRows = asArray(root.memoryEntries).map((m) => asObject(m) ?? {});
        const supersedeQueue: Array<{ id: string; oldSupersedes: string }> = [];
        for (const m of memoryRows) {
          const created = await tx.memoryEntry.create({
            data: {
              projectId: project.id,
              category: clip(m.category, "chapter-note", 40),
              key: strOrNull(m.key),
              title: strOrNull(m.title),
              content: str(m.content),
              status: clip(m.status, "unknown", 20),
              sourceCitationsJson: remapCitations(m.citations),
              isUserEdited: m.isUserEdited === true,
              revision: num(m.revision, 1),
              isCurrent: m.isCurrent !== false,
            },
          });
          const oldId = strOrNull(m.id);
          if (oldId) entryMap.set(oldId, created.id);
          const oldSupersedes = strOrNull(m.supersedesId);
          if (oldSupersedes) supersedeQueue.push({ id: created.id, oldSupersedes });
        }
        for (const { id, oldSupersedes } of supersedeQueue) {
          const mapped = entryMap.get(oldSupersedes);
          if (mapped) await tx.memoryEntry.update({ where: { id }, data: { supersedesId: mapped } });
        }

        const knowledgeRows = asArray(root.characterKnowledge);
        for (const k of knowledgeRows) {
          const row = asObject(k);
          if (!row) continue;
          await tx.characterKnowledge.create({
            data: {
              projectId: project.id,
              characterName: clip(row.characterName, "（未知）", 120),
              infoItem: str(row.infoItem),
              relation: clip(row.relation, "known", 20),
            },
          });
        }

        for (const p of asArray(root.continuationPlans)) {
          const row = asObject(p);
          if (!row) continue;
          const created = await tx.continuationPlan.create({
            data: {
              projectId: project.id,
              direction: clip(row.direction, "（未命名方向）", 300),
              summary: strOrNull(row.summary),
              outlineJson: JSON.stringify(asArray(row.outline)),
              relatedThreadsJson: JSON.stringify(asArray(row.relatedThreads)),
              status: clip(row.status, "draft", 20),
              version: num(row.version, 1),
            },
          });
          const oldId = strOrNull(row.id);
          if (oldId) planMap.set(oldId, created.id);
        }

        for (const d of asArray(root.draftChapters)) {
          const row = asObject(d);
          if (!row) continue;
          const oldPlan = strOrNull(row.planId);
          const created = await tx.draftChapter.create({
            data: {
              projectId: project.id,
              planId: oldPlan ? (planMap.get(oldPlan) ?? null) : null,
              index: num(row.index, 1),
              title: strOrNull(row.title),
              content: str(row.content),
              outlineItemJson: JSON.stringify(asObject(row.outlineItem) ?? {}),
              version: num(row.version, 1),
              continuityCheckJson: JSON.stringify(asObject(row.continuityCheck) ?? {}),
              memoryUpdateStatus: clip(row.memoryUpdateStatus, "none", 20),
            },
          });
          const oldId = strOrNull(row.id);
          if (oldId) draftMap.set(oldId, created.id);
        }

        /** 问题证据：章节/记忆/草稿引用都要改指到新 id；指向已删除对象时丢弃该条证据。 */
        const remapEvidence = (value: unknown): string => {
          const out: unknown[] = [];
          for (const item of asArray(value)) {
            const ev = asObject(item);
            if (!ev) continue;
            const kind = str(ev.kind);
            const mapRef = (old: string | null, map: Map<string, string>) => {
              const mapped = old ? map.get(old) : undefined;
              if (!mapped) droppedCitations += 1;
              return mapped;
            };
            if (kind === "chapter") {
              const mapped = mapRef(strOrNull(ev.chapterId), chapterMap);
              if (mapped) out.push({ ...ev, chapterId: mapped });
            } else if (kind === "memory") {
              const mapped = mapRef(strOrNull(ev.entryId), entryMap);
              if (mapped) out.push({ ...ev, entryId: mapped });
            } else if (kind === "draft") {
              const mapped = mapRef(strOrNull(ev.draftId), draftMap);
              if (mapped) out.push({ ...ev, draftId: mapped });
            }
          }
          return JSON.stringify(out);
        };

        let issueCount = 0;
        for (const i of asArray(root.continuityIssues)) {
          const row = asObject(i);
          if (!row) continue;
          const oldDraft = strOrNull(row.draftId);
          await tx.continuityIssue.create({
            data: {
              projectId: project.id,
              draftId: oldDraft ? (draftMap.get(oldDraft) ?? null) : null,
              category: clip(row.category, "其他", 40),
              severity: clip(row.severity, "info", 20),
              description: str(row.description),
              evidenceJson: remapEvidence(row.evidence),
              status: clip(row.status, "open", 20),
            },
          });
          issueCount += 1;
        }

        let proposalCount = 0;
        for (const p of asArray(root.memoryProposals)) {
          const row = asObject(p);
          if (!row) continue;
          const oldChapter = strOrNull(row.chapterId);
          const oldDraft = strOrNull(row.draftId);
          const oldTarget = strOrNull(row.targetEntryId);
          await tx.memoryProposal.create({
            data: {
              projectId: project.id,
              // 分析运行不导出，来源运行号一律置空。
              runId: null,
              chapterId: oldChapter ? (chapterMap.get(oldChapter) ?? null) : null,
              draftId: oldDraft ? (draftMap.get(oldDraft) ?? null) : null,
              kind: clip(row.kind, "add", 20),
              category: clip(row.category, "chapter-note", 40),
              key: strOrNull(row.key),
              title: strOrNull(row.title),
              content: str(row.content),
              status: clip(row.status, "inferred", 20),
              citationsJson: remapCitations(row.citations),
              targetEntryId: oldTarget ? (entryMap.get(oldTarget) ?? null) : null,
              reason: strOrNull(row.reason),
              state: clip(row.state, "pending", 20),
            },
          });
          proposalCount += 1;
        }

        return {
          projectId: project.id,
          projectName: name,
          chapterCount: chapterRows.length,
          memoryCount: memoryRows.length,
          knowledgeCount: knowledgeRows.length,
          planCount: planMap.size,
          draftCount: draftMap.size,
          issueCount,
          proposalCount,
          droppedCitations,
        };
      },
      { timeout: 60_000, maxWait: 15_000 },
    );
  } catch (error) {
    // 恢复失败不留半成品：删项目（级联清数据）并清掉本机源文副本。
    await prisma.novelProject.delete({ where: { id: project.id } }).catch(() => {});
    await rm(projectDir(project.id), { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
