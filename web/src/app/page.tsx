import { requirePageUser } from "@/lib/auth-session";
import { ProjectLibrary } from "@/components/projects/project-library";
import { listProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await requirePageUser();
  const projects = await listProjects();
  return <ProjectLibrary projects={projects} />;
}
