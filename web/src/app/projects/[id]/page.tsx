import { notFound } from "next/navigation";
import { formatLabel } from "@/lib/domain";
import { listChapterSummaries } from "@/lib/chapters";
import { getProjectWorkspace } from "@/lib/projects";
import { ChapterWorkspace } from "@/components/projects/chapter-workspace";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const workspace = await getProjectWorkspace(id);
  if (!workspace) notFound();

  const { project, source } = workspace;
  const chapters = await listChapterSummaries(id);

  return (
    <ChapterWorkspace
      projectId={project.id}
      projectName={project.name}
      genre={project.genre}
      source={
        source
          ? {
              fileName: source.fileName,
              formatLabel: formatLabel(source.format),
              byteSize: source.byteSize,
              encoding: source.encoding,
              importedAt: source.importedAt.toISOString(),
            }
          : null
      }
      initialChapters={chapters}
    />
  );
}
