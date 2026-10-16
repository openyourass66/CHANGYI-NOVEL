import { requirePageUser } from "@/lib/auth-session";
import { notFound } from "next/navigation";
import { getWorkspaceView } from "@/lib/workspaces";
import { WorkspaceView } from "@/components/projects/workspace-view";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{id:string}>;  }) {
 await requirePageUser();
 const data = await getWorkspaceView((await params).id, "continuation");
 if(!data) notFound();
 return <WorkspaceView data={data}  />;
}
