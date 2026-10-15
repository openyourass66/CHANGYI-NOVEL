import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { clampStatus, collect, resolveCitation } from "@/lib/ai/citations";
import { requestJson } from "@/lib/ai/structured";
import { createProposalsFromRun } from "@/lib/ai/proposals";
import type { ChapterView } from "@/lib/chapters-view";
import type { ProposalDraft } from "@/lib/ai/types";
import type { TaskDefinition, TaskUnit } from "@/lib/ai/tasks/types";

export const PROMPT_VERSION = "chapter-extract@1";

/** 每项抽取结果都必须附带原文片段（excerpt），用于回链定位。 */
const excerpt = z.string().trim().min(1).max(300);

const knowledgeItem = z.object({
  infoItem: z.string().trim().min(1).max(300),
  relation: z.enum(["known", "misbelieved", "unknown"]),
  excerpt,
});

const characterItem = z.object({
  name: z.string().trim().min(1).max(80),
  state: z.string().trim().max(600).default(""),
  knowledge: z.array(knowledgeItem).max(20).default([]),
  excerpt,
});

export const chapterExtractSchema = z.object({
  chapterNote: z.object({
    summary: z.string().trim().min(1).max(2000),
    excerpt,
  }),
  events: z
    .array(z.object({ description: z.string().trim().min(1).max(600), excerpt }))
    .max(40)
    .default([]),
  characters: z.array(characterItem).max(40).default([]),
  settings: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        detail: z.string().trim().min(1).max(1200),
        excerpt,
      }),
    )
    .max(40)
    .default([]),
  threads: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        detail: z.string().trim().min(1).max(1200),
        state: z.enum(["open", "advanced", "resolved", "uncertain"]).default("open"),
        excerpt,
      }),
    )
    .max(40)
    .default([]),
  glossary: z
    .array(
      z.object({
        term: z.string().trim().min(1).max(120),
        definition: z.string().trim().min(1).max(1200),
        excerpt,
      }),
    )
    .max(40)
    .default([]),
});

export type ChapterExtractOutput = z.infer<typeof chapterExtractSchema>;

const SYSTEM = [
  "你是一名严谨的小说文本分析师。你的唯一依据是用户提供的章节原文。",
  "硬性规则：",
  "1. 原文即正典。不得用外部知识、常识或推测补充原文未写出的内容。",
  "2. 严格区分「明述」与「推断」：只陈述原文明确写出的内容，不要把推测当作事实。",
  "3. 每一项结论都必须给出原文片段（excerpt），且该片段必须逐字出现在原文中。",
  "4. 人物认知需区分已知 / 误信 / 未知：角色「以为」的归入误信，明确不知道的归入未知。",
  "5. 找不到依据时，宁可不输出该项，也不要编造。",
].join("\n");

/** 构造抽取提示。JSON-only 约束由 requestJson 统一追加，此处不重复。 */
export function buildPrompt(chapter: ChapterView): { system: string; prompt: string } {
  const prompt = [
    `章节标题：${chapter.rawTitle}`,
    "",
    "请抽取以下结构化信息，字段名与结构严格如下：",
    '{ "chapterNote": { "summary": string, "excerpt": string },',
    '  "events": [{ "description": string, "excerpt": string }],',
    '  "characters": [{ "name": string, "state": string, "knowledge": [{ "infoItem": string, "relation": "known"|"misbelieved"|"unknown", "excerpt": string }], "excerpt": string }],',
    '  "settings": [{ "name": string, "detail": string, "excerpt": string }],',
    '  "threads": [{ "title": string, "detail": string, "state": "open"|"advanced"|"resolved"|"uncertain", "excerpt": string }],',
    '  "glossary": [{ "term": string, "definition": string, "excerpt": string }] }',
    "",
    "excerpt 必须是原文中逐字出现的片段，用于回链定位。",
    "",
    "章节原文：",
    "———",
    chapter.content,
    "———",
  ].join("\n");
  return { system: SYSTEM, prompt };
}

/**
 * 将抽取结果映射为提案草稿。出处无法在原文定位时不静默丢弃，而是计入 unresolved
 * 由调用方记录（该条目仍生成，只是缺少对应出处）。
 */
export function toProposals(
  chapter: ChapterView,
  output: ChapterExtractOutput,
): { drafts: ProposalDraft[]; unresolved: string[] } {
  const drafts: ProposalDraft[] = [];
  const unresolved: string[] = [];

  // 章节笔记（含事件列表）
  {
    const { citations, unresolved: miss } = collect(chapter, [output.chapterNote.excerpt]);
    const eventLines = output.events.map(
      (e, i) => `${i + 1}. ${e.description}（依据：${e.excerpt}）`,
    );
    const content = [output.chapterNote.summary, "", ...eventLines].join("\n").trim();
    drafts.push({
      category: "chapter-note",
      key: `ch:${chapter.id}`,
      title: `笔记：${chapter.rawTitle}`,
      content,
      status: clampStatus("chapter-note", "confirmed"),
      citations,
    });
    unresolved.push(...miss);
    for (const e of output.events) {
      const ref = resolveCitation(chapter, e.excerpt);
      if (ref) drafts[drafts.length - 1].citations.push(ref);
      else unresolved.push(e.excerpt);
    }
  }

  // 人物
  for (const c of output.characters) {
    const { citations, unresolved: miss } = collect(chapter, [c.excerpt]);
    const knowledgeLines = c.knowledge.map(
      (k) => `- ${k.infoItem}（${RELATION_LABEL[k.relation]}）`,
    );
    const content = [c.state, ...(knowledgeLines.length ? ["", "认知：", ...knowledgeLines] : [])]
      .join("\n")
      .trim();
    if (!content) continue;
    drafts.push({
      category: "character",
      key: c.name,
      title: c.name,
      content,
      status: clampStatus("character", "confirmed"),
      citations,
    });
    unresolved.push(...miss);
    for (const k of c.knowledge) {
      const ref = resolveCitation(chapter, k.excerpt);
      if (ref) drafts[drafts.length - 1].citations.push(ref);
      else unresolved.push(k.excerpt);
    }
  }

  // 设定
  for (const s of output.settings) {
    const { citations, unresolved: miss } = collect(chapter, [s.excerpt]);
    drafts.push({
      category: "story-bible",
      key: s.name,
      title: s.name,
      content: s.detail,
      status: clampStatus("story-bible", "confirmed"),
      citations,
    });
    unresolved.push(...miss);
  }

  // 悬念/线索
  for (const t of output.threads) {
    const { citations, unresolved: miss } = collect(chapter, [t.excerpt]);
    drafts.push({
      category: "thread",
      key: t.title,
      title: t.title,
      content: t.detail,
      status: clampStatus("thread", t.state),
      citations,
    });
    unresolved.push(...miss);
  }

  // 术语
  for (const g of output.glossary) {
    const { citations, unresolved: miss } = collect(chapter, [g.excerpt]);
    drafts.push({
      category: "glossary",
      key: g.term,
      title: g.term,
      content: g.definition,
      status: clampStatus("glossary", "confirmed"),
      citations,
    });
    unresolved.push(...miss);
  }

  return { drafts, unresolved };
}

const RELATION_LABEL: Record<"known" | "misbelieved" | "unknown", string> = {
  known: "已知",
  misbelieved: "误信",
  unknown: "未知",
};

function chapterWhere(projectId: string, chapterIds?: string[]) {
  return {
    projectId,
    ...(chapterIds && chapterIds.length > 0 ? { id: { in: chapterIds } } : {}),
  };
}

async function runUnit(unit: TaskUnit, ctx: Parameters<TaskDefinition["runUnit"]>[1]) {
  const chapterId = unit.chapterId ?? unit.id;
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter) return { usage: {}, produced: 0 };

  const view: ChapterView = {
    id: chapter.id,
    volumeNumber: chapter.volumeNumber,
    volumeTitle: chapter.volumeTitle,
    rawTitle: chapter.rawTitle,
    normalizedIndex: chapter.normalizedIndex,
    sortOrder: chapter.sortOrder,
    content: chapter.content,
    charCount: chapter.content.length,
    splitMethod: chapter.splitMethod,
    parseConfidence: chapter.parseConfidence,
    flags: [],
    analysisStatus: chapter.analysisStatus,
  };

  const { system, prompt } = buildPrompt(view);
  const res = await requestJson(ctx.profile, {
    system,
    prompt,
    schema: chapterExtractSchema,
    maxTokens: chapterExtractTask.maxTokens,
  });
  const { drafts, unresolved } = toProposals(view, res.data);
  const created = await createProposalsFromRun(
    ctx.runId,
    ctx.projectId,
    drafts.map((draft) => ({ chapterId: chapter.id, draft })),
  );
  return {
    usage: res.usage,
    produced: created,
    errors:
      unresolved.length > 0
        ? [`第《${chapter.rawTitle}》章有 ${unresolved.length} 条出处未能在原文定位。`]
        : [],
  };
}

export const chapterExtractTask: TaskDefinition = {
  type: "chapter-extract",
  label: "逐章抽取",
  scope: "chapter",
  surface: "analysis",
  promptVersion: PROMPT_VERSION,
  maxTokens: 4096,
  async validate() {
    // 单元枚举为空时由运行器统一报错，无需在此校验。
  },
  async listUnits({ projectId, payload }) {
    const rows = await prisma.chapter.findMany({
      where: chapterWhere(projectId, payload.chapterIds),
      orderBy: { sortOrder: "asc" },
      select: { id: true, rawTitle: true },
    });
    return rows.map((r) => ({ id: r.id, label: r.rawTitle, chapterId: r.id }));
  },
  runUnit,
  async describe({ projectId, payload }) {
    const rows = await prisma.chapter.findMany({
      where: chapterWhere(projectId, payload.chapterIds),
      orderBy: { sortOrder: "asc" },
      select: { content: true },
    });
    const totalChars = rows.reduce((sum, c) => sum + c.content.length, 0);
    return {
      unitCount: rows.length,
      unitLabel: "章节",
      totalChars,
      sampleText: rows[0]?.content.slice(0, 400) ?? "",
      note: "逐章抽取：章节笔记、事件、人物（含认知）、设定、悬念与术语，每条附原文出处。",
    };
  },
};
