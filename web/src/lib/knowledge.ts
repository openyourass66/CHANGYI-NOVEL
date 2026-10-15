import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { KNOWLEDGE_RELATION, type KnowledgeRelation } from "@/lib/domain";
import type { KnowledgeView } from "@/lib/memory-view";

export type { KnowledgeView };

const relationValues = Object.keys(KNOWLEDGE_RELATION) as [
  KnowledgeRelation,
  ...KnowledgeRelation[],
];

export const knowledgeInputSchema = z.object({
  characterName: z.string().trim().min(1, "请填写人物名称").max(80),
  infoItem: z.string().trim().min(1, "请填写信息条目").max(500),
  relation: z.enum(relationValues),
});
export type KnowledgeInput = z.infer<typeof knowledgeInputSchema>;

function toView(row: {
  id: string;
  characterName: string;
  infoItem: string;
  relation: string;
  createdAt: Date;
}): KnowledgeView {
  return {
    id: row.id,
    characterName: row.characterName,
    infoItem: row.infoItem,
    relation: row.relation as KnowledgeRelation,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listKnowledge(projectId: string): Promise<KnowledgeView[]> {
  const rows = await prisma.characterKnowledge.findMany({
    where: { projectId },
    orderBy: [{ characterName: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toView);
}

export async function createKnowledge(
  projectId: string,
  input: KnowledgeInput,
): Promise<KnowledgeView> {
  const row = await prisma.characterKnowledge.create({
    data: {
      projectId,
      characterName: input.characterName,
      infoItem: input.infoItem,
      relation: input.relation,
    },
  });
  return toView(row);
}

export async function updateKnowledge(
  id: string,
  input: KnowledgeInput,
): Promise<KnowledgeView> {
  const existing = await prisma.characterKnowledge.findUnique({ where: { id } });
  if (!existing) throw new Error("认知条目不存在。");
  const row = await prisma.characterKnowledge.update({
    where: { id },
    data: {
      characterName: input.characterName,
      infoItem: input.infoItem,
      relation: input.relation,
    },
  });
  return toView(row);
}

export async function deleteKnowledge(id: string): Promise<void> {
  await prisma.characterKnowledge.deleteMany({ where: { id } });
}
