import { parseMemoryDocument } from "@/lib/memory-import/parse";
import { decodeText } from "./import/parse";
import { api } from "./bridge";

type Chapter = { id: string; rawTitle: string };
type Draft = ReturnType<typeof parseMemoryDocument>["entries"][number];

function prepare(draft: Draft, byNumber: Map<number, Chapter>) {
  const chapter = draft.chapterNumber == null ? undefined : byNumber.get(draft.chapterNumber);
  const key = chapter ? `ch:${chapter.id}` : draft.key;
  const citations: Array<{ chapterId: string; startOffset: number; endOffset: number; excerpt: string }> = [];
  const extras: string[] = [];
  const cited = new Set<string>();
  const addExtra = (text: string) => { const value = text.trim(); if (value && !extras.includes(value)) extras.push(value); };
  for (const ref of draft.refs) {
    let matched = false;
    for (const number of ref.numbers) {
      const info = byNumber.get(number);
      if (!info) { addExtra(ref.raw); continue; }
      matched = true;
      if (cited.has(info.id)) continue;
      cited.add(info.id);
      citations.push({ chapterId: info.id, startOffset: 0, endOffset: 0, excerpt: "" });
    }
    if (ref.residual) addExtra(ref.residual);
    else if (ref.numbers.length && !matched) addExtra(ref.raw);
  }
  return {
    category: draft.category,
    key,
    title: draft.title,
    content: extras.length ? `${draft.content}\n\n出处：${extras.join("；")}` : draft.content,
    status: draft.status,
    citations: citations.slice(0, 50),
  };
}

export async function parseMemoryFiles(projectId: string, files: File[]) {
  if (!files.length || files.length > 20) throw new Error("一次最多导入 20 个记忆文件。");
  const workspace = await api<{ chapters: Chapter[] }>(`/api/projects/${projectId}/workspace`);
  const byNumber = new Map(workspace.chapters.map((chapter, index) => [index + 1, chapter] as const));
  const prepared = [];
  for (const file of files) {
    if (!/\.(md|markdown|txt)$/i.test(file.name)) throw new Error("记忆文件仅支持 Markdown 或 TXT。");
    if (file.size > 50 * 1024 * 1024) throw new Error("单个记忆文件不得超过 50MB。");
    try {
      const decoded = await decodeText(new Uint8Array(await file.arrayBuffer()));
      const parsed = parseMemoryDocument(decoded.text, file.name);
      prepared.push({ fileName: file.name, kind: parsed.kind, warnings: parsed.warnings, entries: parsed.entries.map((entry) => prepare(entry, byNumber)), knowledge: parsed.knowledge });
    } catch (error) {
      prepared.push({ fileName: file.name, kind: null, warnings: [], entries: [], knowledge: [], error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { files: prepared };
}
