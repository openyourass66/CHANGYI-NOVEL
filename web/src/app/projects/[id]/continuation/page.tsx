import { requirePageUser } from "@/lib/auth-session";
import { notFound } from "next/navigation";
import { getProjectWorkspace } from "@/lib/projects";
import { listProfiles } from "@/lib/ai/profiles";
import { listTaskSummaries, listTaskTypes } from "@/lib/ai/tasks/registry";
import { latestRunsByType } from "@/lib/ai/runner";
import { listPlans } from "@/lib/continuation";
import { memoryCounts } from "@/lib/memory";
import { ContinuationPanel } from "@/components/projects/continuation-panel";

export const dynamic = "force-dynamic";

export default async function ContinuationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePageUser();
  const { id } = await params;
  const workspace = await getProjectWorkspace(id);
  if (!workspace) notFound();

  // 只恢复续写类任务，避免把分析页的逐章抽取运行混进续写页。
  const taskTypes = listTaskTypes("continuation");
  const [profiles, plans, taskRuns, memCounts] = await Promise.all([
    listProfiles(),
    listPlans(id),
    latestRunsByType(id, taskTypes),
    memoryCounts(id),
  ]);

  const totalMemory = Object.values(memCounts).reduce((sum, n) => sum + n, 0);
  // 恢复视图时选中「最近一次运行」所属的步骤，避免配置停在别的步骤上造成错位。
  const newest =
    Object.values(taskRuns)
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;

  return (
    <ContinuationPanel
      projectId={workspace.project.id}
      projectName={workspace.project.name}
      profiles={profiles}
      tasks={listTaskSummaries("continuation")}
      initialPlans={plans}
      initialRun={newest}
      taskRuns={taskRuns}
      hasMemory={totalMemory > 0}
      initialStage={newest?.taskType ?? null}
    />
  );
}
