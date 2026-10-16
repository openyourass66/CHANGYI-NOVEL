import "server-only";
import type { WorkspaceKind, WorkspaceView, SettingsView } from "@contracts/workspace";
import { getProjectWorkspace } from "@/lib/projects";
import { listChapterSummaries } from "@/lib/chapters";
import { formatLabel } from "@/lib/domain";
import { listProfiles } from "@/lib/ai/profiles";
import { listProposals, proposalCounts } from "@/lib/ai/proposals";
import { latestRunsByType } from "@/lib/ai/runner";
import { listTaskSummaries, listTaskTypes } from "@/lib/ai/tasks/registry";
import { findKeyConflicts, listMemoryEntries, memoryCounts } from "@/lib/memory";
import { listKnowledge } from "@/lib/knowledge";
import { listPlans } from "@/lib/continuation";
import { isEncryptionConfigured } from "@/lib/crypto";

/** 网页与桌面共享相同数据边界；只返回展示字段，不暴露存储路径或模型密文。 */
export async function getWorkspaceView(id: string, view: WorkspaceKind): Promise<WorkspaceView | null> {
  const workspace = await getProjectWorkspace(id);
  if (!workspace) return null;
  const { project, source } = workspace;
  const base = { projectId: project.id, projectName: project.name };
  if (view === "chapters") return { view, props: { ...base, genre: project.genre,
    source: source ? { fileName: source.fileName, formatLabel: formatLabel(source.format), byteSize: source.byteSize, encoding: source.encoding, importedAt: source.importedAt.toISOString() } : null,
    initialChapters: await listChapterSummaries(id),
  } };
  if (view === "memory") {
    const [initialEntries, initialCounts, initialConflicts, initialKnowledge, chapters] = await Promise.all([
      listMemoryEntries(id), memoryCounts(id), findKeyConflicts(id), listKnowledge(id), listChapterSummaries(id),
    ]);
    return { view, props: { ...base, initialEntries, initialCounts, initialConflicts, initialKnowledge,
      chapters: chapters.map((c, i) => ({ id: c.id, index: i + 1, title: c.rawTitle })),
    } };
  }
  const [profiles, taskRuns, counts] = await Promise.all([listProfiles(), latestRunsByType(id, listTaskTypes(view)), memoryCounts(id)]);
  const initialRun = Object.values(taskRuns).filter((r): r is NonNullable<typeof r> => Boolean(r)).sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const totalMemory = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const common = { ...base, profiles, taskRuns, initialRun, initialStage: initialRun?.taskType ?? null, hasMemory: totalMemory > 0, tasks: listTaskSummaries(view) };
  if (view === "continuation") return { view, props: { ...common, initialPlans: await listPlans(id) } };
  const [chapters, initialProposals, initialCounts] = await Promise.all([listChapterSummaries(id), listProposals(id), proposalCounts(id)]);
  return { view, props: { ...common, totalMemory, initialProposals, initialCounts,
    chapters: chapters.map((c,i) => ({ id: c.id, index: i + 1, title: c.rawTitle, charCount: c.charCount })),
  } };
}

export async function getSettingsView(): Promise<SettingsView> {
  return { profiles: await listProfiles(), encryptionReady: isEncryptionConfigured(), serverOnly: process.env.ALLOW_SERVER_LOCAL_MODELS === "false" };
}
