import { notFound } from "next/navigation";
import { listChapterSummaries } from "@/lib/chapters";
import { getProjectWorkspace } from "@/lib/projects";
import { listKnowledge } from "@/lib/knowledge";
import { findKeyConflicts, listMemoryEntries, memoryCounts } from "@/lib/memory";
import { MemoryWorkbench } from "@/components/projects/memory-workbench";

export const dynamic = "force-dynamic";

export default async function MemoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ entry?: string }>;
}) {
  const { id } = await params;
  const { entry } = await searchParams;
  const workspace = await getProjectWorkspace(id);
  if (!workspace) notFound();

  const [entries, counts, conflicts, knowledge, chapters] = await Promise.all([
    listMemoryEntries(id),
    memoryCounts(id),
    findKeyConflicts(id),
    listKnowledge(id),
    listChapterSummaries(id),
  ]);

  const chapterOptions = chapters.map((c, i) => ({
    id: c.id,
    index: i + 1,
    title: c.rawTitle,
  }));

  return (
    <MemoryWorkbench
      projectId={workspace.project.id}
      projectName={workspace.project.name}
      initialEntries={entries}
      initialCounts={counts}
      initialConflicts={conflicts}
      initialKnowledge={knowledge}
      chapters={chapterOptions}
      focusEntryId={entry ?? null}
    />
  );
}
