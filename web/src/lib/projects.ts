import "server-only";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { projectDir } from "@/lib/storage";

export const projectInputSchema = z.object({
  name: z.string().trim().min(1, "请填写项目名称").max(120),
  language: z.string().trim().min(1).max(20).default("zh"),
  genre: z.string().trim().max(40).optional(),
});
export type ProjectInput = z.infer<typeof projectInputSchema>;

export type ProjectSummary = {
  id: string;
  name: string;
  language: string;
  genre: string | null;
  createdAt: string;
  updatedAt: string;
  chapterCount: number;
  sourceCount: number;
  memoryCount: number;
};

export async function listProjects(): Promise<ProjectSummary[]> {
  const rows = await prisma.novelProject.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { chapters: true, sourceDocuments: true, memoryEntries: true } },
    },
  });
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    language: p.language,
    genre: p.genre,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    chapterCount: p._count.chapters,
    sourceCount: p._count.sourceDocuments,
    memoryCount: p._count.memoryEntries,
  }));
}

export async function createProject(input: ProjectInput) {
  return prisma.novelProject.create({
    data: {
      name: input.name,
      language: input.language,
      genre: input.genre?.trim() || null,
    },
  });
}

export async function getProject(id: string) {
  return prisma.novelProject.findUnique({ where: { id } });
}

export async function getProjectOverview(id: string) {
  const project = await prisma.novelProject.findUnique({
    where: { id },
    include: {
      sourceDocuments: { orderBy: { importedAt: "desc" } },
      chapters: { orderBy: { sortOrder: "asc" } },
    },
  });
  return project;
}

export async function getProjectWorkspace(id: string) {
  const project = await prisma.novelProject.findUnique({ where: { id } });
  if (!project) return null;
  const source = await prisma.sourceDocument.findFirst({
    where: { projectId: id },
    orderBy: { importedAt: "desc" },
  });
  return { project, source };
}

export async function deleteProject(id: string) {
  const project = await prisma.novelProject.findUnique({ where: { id } });
  if (!project) return;
  await prisma.novelProject.delete({ where: { id } });
  // 清理本机文件（源文与导出）
  await rm(projectDir(id), { recursive: true, force: true }).catch(() => {});
}
