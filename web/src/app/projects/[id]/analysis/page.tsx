import { notFound } from "next/navigation";
import { listChapterSummaries } from "@/lib/chapters";
import { getProjectWorkspace } from "@/lib/projects";
import { listProfiles } from "@/lib/ai/profiles";
import { listProposals, proposalCounts } from "@/lib/ai/proposals";
import { latestRunsByType } from "@/lib/ai/runner";
import { listTaskSummaries, listTaskTypes } from "@/lib/ai/tasks/registry";
import { memoryCounts } from "@/lib/memory";
import { AnalysisPanel } from "@/components/projects/analysis-panel";

export const dynamic = "force-dynamic";

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const workspace = await getProjectWorkspace(id);
  if (!workspace) notFound();

  // 只恢复理解分析类任务，避免把续写页的运行混进来。
  const taskTypes = listTaskTypes("analysis");
  const [chapters, profiles, proposals, counts, taskRuns, memCounts] = await Promise.all([
    listChapterSummaries(id),
    listProfiles(),
    listProposals(id),
    proposalCounts(id),
    latestRunsByType(id, taskTypes),
    memoryCounts(id),
  ]);

  const chapterOptions = chapters.map((c, i) => ({
    id: c.id,
    index: i + 1,
    title: c.rawTitle,
    charCount: c.charCount,
  }));

  const totalMemory = Object.values(memCounts).reduce((sum, n) => sum + n, 0);
  // 恢复视图时选中「最近一次运行」所属的步骤，避免配置停在别的步骤上造成错位。
  const newest = Object.values(taskRuns)
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;

  return (
    <AnalysisPanel
      projectId={workspace.project.id}
      projectName={workspace.project.name}
      chapters={chapterOptions}
      profiles={profiles}
      tasks={listTaskSummaries("analysis")}
      initialProposals={proposals}
      initialCounts={counts}
      initialRun={newest}
      taskRuns={taskRuns}
      totalMemory={totalMemory}
      hasMemory={totalMemory > 0}
      initialStage={newest?.taskType ?? null}
    />
  );
}
