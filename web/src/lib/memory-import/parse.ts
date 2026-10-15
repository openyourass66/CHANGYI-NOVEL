/**
 * 解析 novel-continuation 技能的「记忆文件」Markdown（templates/*.md）为记忆草稿。
 * 纯函数：不触碰数据库；出处只保留「第 N 章」的章节号，交由服务层映射为章节 id。
 */
import {
  MEMORY_CATEGORY_DEFAULT_STATUS,
  MEMORY_STATUS,
  type KnowledgeRelation,
  type MemoryCategory,
  type MemoryStatus,
} from "@/lib/domain";
import { clampStatus } from "@/lib/ai/citations";
import { NUMBER_CHARS, parseNumber } from "@/lib/import/numerals";
import {
  bulletLines,
  columnIndex,
  keyValueLines,
  parseSections,
  parseTables,
  stripMarkup,
  type Section,
  type Table,
} from "./markdown";

export type MemoryDocKind =
  | "chapter-notes"
  | "story-bible"
  | "characters"
  | "timeline"
  | "open-threads"
  | "style-guide"
  | "continuation-outline";

/** 出处注解：章节号（可能为空，如「开篇」）＋无法归入章节的残余文字（如「推断，依据」）。 */
export type ParsedRef = { numbers: number[]; raw: string; residual: string };

export type MemoryEntryDraft = {
  category: MemoryCategory;
  key: string;
  title: string;
  content: string;
  status: MemoryStatus;
  refs: ParsedRef[];
  /** 章节笔记专用：能对上项目章节时，服务层据此改用 `ch:<chapterId>` 作键。 */
  chapterNumber: number | null;
};

export type ParsedKnowledge = {
  characterName: string;
  infoItem: string;
  relation: KnowledgeRelation;
};

export type ParseResult = {
  kind: MemoryDocKind | null;
  entries: MemoryEntryDraft[];
  knowledge: ParsedKnowledge[];
  warnings: string[];
};

const NUM = `[${NUMBER_CHARS}]`;
const RANGE_REF = new RegExp(`第\\s*(${NUM}+)\\s*[–—~～至到\\-]\\s*(?:第)?\\s*(${NUM}+)\\s*[章回节]`, "g");
const SINGLE_REF = new RegExp(`第\\s*(${NUM}+)\\s*[章回节]`, "g");
const REF_PAREN = new RegExp(
  `[（(]\\s*(?:第\\s*${NUM}+\\s*[章回节]|第\\s*${NUM}+\\s*[–—~～至到\\-]\\s*${NUM}+\\s*[章回节])\\s*[）)]`,
  "g",
);

const CONTENT_MAX = 20000;
const KEY_MAX = 120;
const TITLE_MAX = 200;
const INFO_MAX = 500;

/* ------------------------------- 文本工具 ------------------------------- */

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

function isPlaceholder(text: string): boolean {
  const t = stripMarkup(text);
  return t.length === 0 || /^<[^>]*>$/.test(t);
}

function isValid(text: string): boolean {
  return !isPlaceholder(text);
}

/** 去掉字段名与标点后是否还有实质内容——用于跳过 `- 事件：` 这类空占位行。 */
function hasContent(text: string): boolean {
  const body = text
    .split(/[\n；;]/)
    .map((line) => line.replace(/^[^：:]{1,40}[：:]\s*/, ""))
    .join("")
    .replace(/[\s\-·、,，。.：:；;！!？?（）()【】[\]]/g, "");
  return body.length > 0;
}

/** 拼接 `字段：值` 形式的正文，跳过空字段与占位符。 */
function joinFields(fields: [string, string][]): string {
  return fields
    .filter(([, v]) => isValid(v))
    .map(([k, v]) => (k ? `${k}：${v}` : v))
    .join("\n");
}

function extractRefNumbers(text: string): number[] {
  const found = new Set<number>();
  const consumed = text.replace(RANGE_REF, (_all, from: string, to: string) => {
    const a = parseNumber(from);
    const b = parseNumber(to);
    if (a != null && b != null) {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      if (hi - lo <= 200) for (let i = lo; i <= hi; i++) found.add(i);
    }
    return " ";
  });
  for (const m of consumed.matchAll(SINGLE_REF)) {
    const n = parseNumber(m[1]);
    if (n != null) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}

/** 去掉章节号后剩下的注解文字（如「推断，依据」）；纯章节号返回空串。 */
function refResidual(text: string): string {
  return text
    .replace(RANGE_REF, "")
    .replace(SINGLE_REF, "")
    .replace(/[（）()【】[\],，；;：:…——\-–~～\s]/g, "")
    .trim();
}

/** 括号内只有这些词时才算「出处注解」，避免把「（概括即可）」之类的说明误当出处。 */
const RESIDUAL_ANNOTATION =
  /推断|明述|未知|存疑|未决|推进中|已回收|已解决|开篇|序章|楔子|尾声|inferred|confirmed|unknown|open|advanced|resolved|uncertain/i;

/**
 * 从一段文本挑出处：优先取括号内的注解；整段本身就是「第N章」时取整段。
 * 括号内的残余（如 inferred、推断依据）单独保留，供服务层回填正文。
 */
function extractRefs(text: string): ParsedRef[] {
  const clean = stripMarkup(text);
  if (!clean) return [];
  const refs: ParsedRef[] = [];
  const seen = new Set<string>();
  for (const m of clean.matchAll(/[（(]([^）)]*)[）)]/g)) {
    const inner = m[1].trim();
    if (!inner) continue;
    const numbers = extractRefNumbers(inner);
    const residual = refResidual(inner);
    if (numbers.length === 0 && !RESIDUAL_ANNOTATION.test(residual)) continue;
    const dedupeKey = `${numbers.join(",")}|${residual}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    refs.push({ numbers, raw: inner, residual });
  }
  if (refs.length === 0) {
    const numbers = extractRefNumbers(clean);
    if (numbers.length > 0) refs.push({ numbers, raw: clean, residual: "" });
  }
  return refs;
}

/** 从多个字段合并出处并去重。 */
function mergeRefs(...texts: (string | undefined)[]): ParsedRef[] {
  const out: ParsedRef[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const ref of extractRefs(text)) {
      const k = `${ref.numbers.join(",")}|${ref.residual}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(ref);
    }
  }
  return out;
}

const STATUS_LABEL: Record<string, MemoryStatus> = Object.fromEntries(
  Object.entries(MEMORY_STATUS).map(([key, label]) => [label, key as MemoryStatus]),
);

/** 解析状态：接受英文键（confirmed/open…）或中文标签（明述/未决…）。 */
function parseStatus(text: string | undefined): MemoryStatus | null {
  if (!text) return null;
  const t = stripMarkup(text).toLowerCase();
  for (const key of Object.keys(MEMORY_STATUS) as MemoryStatus[]) {
    if (t.includes(key)) return key;
  }
  for (const [label, key] of Object.entries(STATUS_LABEL)) {
    if (t.includes(label)) return key;
  }
  return null;
}

function splitList(text: string): string[] {
  return text
    .split(/[、，,；;]+/)
    .map((s) => stripMarkup(s).replace(REF_PAREN, "").trim())
    .filter((s) => s.length > 0);
}

function chapterNumberFromTitle(title: string): number | null {
  const m = new RegExp(`^第\\s*(${NUM}+)\\s*[章回节]`).exec(stripMarkup(title));
  return m ? parseNumber(m[1]) : null;
}

/* ------------------------------ 分派与解析 ------------------------------ */

const FILENAME_KINDS: [RegExp, MemoryDocKind][] = [
  [/chapter[-_ ]?note/i, "chapter-notes"],
  [/story[-_ ]?bible/i, "story-bible"],
  [/character/i, "characters"],
  [/timeline/i, "timeline"],
  [/open[-_ ]?thread/i, "open-threads"],
  [/style[-_ ]?guide/i, "style-guide"],
  [/continuation[-_ ]?outline/i, "continuation-outline"],
];

const HEADING_KINDS: [RegExp, MemoryDocKind][] = [
  [/章节记录|章节笔记/, "chapter-notes"],
  [/设定集/, "story-bible"],
  [/人物表|人物/, "characters"],
  [/时间线/, "timeline"],
  [/悬念台账|悬念/, "open-threads"],
  [/文风指南|文风/, "style-guide"],
  [/续写大纲/, "continuation-outline"],
];

export function detectKind(fileName: string, text: string): MemoryDocKind | null {
  const base = fileName.replace(/\.[^.]+$/, "");
  for (const [re, kind] of FILENAME_KINDS) if (re.test(base)) return kind;

  const title = parseSections(text).find((s) => s.level === 1)?.title ?? "";
  for (const [re, kind] of HEADING_KINDS) if (re.test(title)) return kind;
  for (const [re, kind] of HEADING_KINDS) if (re.test(text.slice(0, 400))) return kind;
  return null;
}

export function parseMemoryDocument(text: string, fileName: string): ParseResult {
  const kind = detectKind(fileName, text);
  if (!kind) {
    return { kind: null, entries: [], knowledge: [], warnings: ["无法识别记忆文件类型。"] };
  }
  const sections = parseSections(text);
  const warnings: string[] = [];
  const builder = new Builder(warnings);
  switch (kind) {
    case "chapter-notes":
      parseChapterNotes(sections, builder);
      break;
    case "story-bible":
      parseStoryBible(sections, builder);
      break;
    case "characters":
      parseCharacters(sections, builder);
      break;
    case "timeline":
      parseTimeline(sections, builder);
      break;
    case "open-threads":
      parseOpenThreads(sections, builder);
      break;
    case "style-guide":
      parseStyleGuide(sections, builder);
      break;
    case "continuation-outline":
      parseOutline(sections, builder);
      break;
  }
  return { kind, ...builder.result() };
}

/** 收集草稿、统一裁剪长度并跳过空条目。 */
class Builder {
  readonly entries: MemoryEntryDraft[] = [];
  readonly knowledge: ParsedKnowledge[] = [];
  private readonly seenKeys = new Set<string>();

  constructor(private readonly warnings: string[]) {}

  add(draft: {
    category: MemoryCategory;
    key: string;
    title?: string;
    content: string;
    status?: MemoryStatus | null;
    refs?: ParsedRef[];
    chapterNumber?: number | null;
  }): void {
    const content = clip(draft.content.trim(), CONTENT_MAX);
    if (!content || !hasContent(content)) return;
    const key = clip(draft.key.trim(), KEY_MAX);
    if (!key) return;
    const identity = `${draft.category}::${key}`;
    if (this.seenKeys.has(identity)) {
      this.warnings.push(`文档内重复条目已跳过：${key}`);
      return;
    }
    this.seenKeys.add(identity);
    this.entries.push({
      category: draft.category,
      key,
      title: clip(draft.title?.trim() || key, TITLE_MAX),
      content,
      status: clampStatus(
        draft.category,
        draft.status ?? MEMORY_CATEGORY_DEFAULT_STATUS[draft.category],
      ),
      refs: draft.refs ?? [],
      chapterNumber: draft.chapterNumber ?? null,
    });
  }

  addKnowledge(items: ParsedKnowledge[]): void {
    for (const item of items) {
      const infoItem = clip(item.infoItem.trim(), INFO_MAX);
      if (!infoItem) continue;
      const exists = this.knowledge.some(
        (k) =>
          k.characterName === item.characterName &&
          k.infoItem === infoItem &&
          k.relation === item.relation,
      );
      if (exists) continue;
      this.knowledge.push({ ...item, infoItem });
    }
  }

  result() {
    return { entries: this.entries, knowledge: this.knowledge, warnings: this.warnings };
  }
}

function parseChapterNotes(sections: Section[], b: Builder): void {
  for (const section of sections) {
    if (section.level !== 2 || !isValid(section.title)) continue;
    const number = chapterNumberFromTitle(section.title);
    const fields = keyValueLines(section.lines).map(
      ({ key, value }) => [key, value.replace(REF_PAREN, "").trim()] as [string, string],
    );
    const content = joinFields(fields) || bulletLines(section.lines).join("\n");
    const body = bulletLines(section.lines).join("\n");
    b.add({
      category: "chapter-note",
      key: number != null ? `ch:${number}` : `ch:${section.title}`,
      title: section.title,
      content,
      status: parseStatus(body) ?? "confirmed",
      refs: mergeRefs(body),
      chapterNumber: number,
    });
  }
}

function parseStoryBible(sections: Section[], b: Builder): void {
  for (const section of sections) {
    const title = section.title;
    const tables = parseTables(section.lines);

    if (/术语|写法表|称谓/.test(title)) {
      for (const table of tables) {
        const termCol = columnIndex(table.header, ["标准写法", "术语", "条目", "角色"]);
        const banCol = columnIndex(table.header, ["禁止写法", "禁用"]);
        const noteCol = columnIndex(table.header, ["说明", "备注", "内容"]);
        if (termCol < 0) continue;
        for (const row of table.rows) {
          const term = row[termCol] ?? "";
          if (!isValid(term)) continue;
          const detail = joinFields([
            ["禁止写法", banCol >= 0 ? row[banCol] ?? "" : ""],
            ["说明", noteCol >= 0 ? row[noteCol] ?? "" : ""],
          ]);
          b.add({
            category: "glossary",
            key: `gl:${term}`,
            title: term,
            content: detail || term,
          });
        }
      }
      continue;
    }

    if (/禁忌|家规/.test(title)) {
      for (const bullet of bulletLines(section.lines)) {
        const [text, annotation = ""] = bullet.split(/\s*(?:——|--|—)\s*/, 2);
        if (!isValid(text)) continue;
        b.add({
          category: "story-bible",
          key: `sb:${text}`,
          title: text,
          content: text,
          status: parseStatus(annotation),
          refs: mergeRefs(annotation),
        });
      }
      continue;
    }

    for (const table of tables) {
      addSimpleTable(b, "story-bible", table, {
        titleCols: ["条目", "地点", "名称", "器物", "术语"],
        statusCols: ["状态"],
        refCols: ["出处", "依据", "章节"],
        keyPrefix: "sb",
      });
    }
  }
}

function parseCharacters(sections: Section[], b: Builder): void {
  let parent = "";
  for (const section of sections) {
    if (section.level === 2) {
      parent = section.title;
      if (!/称谓/.test(parent)) continue;
      for (const table of parseTables(section.lines)) {
        const roleCol = columnIndex(table.header, ["角色", "称谓", "人物"]);
        const callCol = columnIndex(table.header, ["称呼", "别人如何称呼"]);
        if (roleCol < 0) continue;
        for (const row of table.rows) {
          const role = row[roleCol] ?? "";
          if (!isValid(role)) continue;
          b.add({
            category: "glossary",
            key: `gl:称谓:${role}`,
            title: role,
            content: joinFields([["称呼", callCol >= 0 ? row[callCol] ?? "" : ""]]) || role,
            refs: mergeRefs(...rowOf(table, row, /出处|章节/)),
          });
        }
      }
      continue;
    }
    if (section.level !== 3 || !isValid(section.title)) continue;
    if (/次要|称谓/.test(parent)) continue;
    if (!splitMemberEntries(section, b)) addCharacter(section, b);
  }

  // 次要人物表（无 level-3 子节）
  for (const section of sections) {
    if (section.level !== 2 || !/次要|其他人物/.test(section.title)) continue;
    for (const table of parseTables(section.lines)) {
      const nameCol = columnIndex(table.header, ["姓名", "角色", "名称"]);
      if (nameCol < 0) continue;
      const fieldCols = table.header
        .map((h, i) => [h, i] as const)
        .filter(([h]) => h && !/^姓名$|^角色$|^名称$/.test(h) && !/出处|章节/.test(h));
      for (const row of table.rows) {
        const name = row[nameCol] ?? "";
        if (!isValid(name)) continue;
        b.add({
          category: "character",
          key: `char:${name}`,
          title: name,
          content: joinFields(fieldCols.map(([h, i]) => [h, row[i] ?? ""])),
          refs: mergeRefs(...rowOf(table, row, /出处|章节/)),
        });
      }
    }
  }
}

/**
 * 人物属性字段词表：`- 键：值` 的键命中它，说明这是角色的属性，而不是另一个人的名字。
 * 用来区分「### 姓名 + 属性」与「### 群体名 + 成员名单」两种写法。
 */
const CHARACTER_FIELD =
  /身份|目标|性格|说话|口吻|关系|状态|身心|变化|已知|误信|未知|证据|出处|依据|身世|经历|能力|结局|感情|行踪|反转|外貌|武器|绰号|阵营|事迹/;

/**
 * `### 群体名` 下若全是 `- 人名：描述`（没有任何键属于人物属性字段），说明成员被写成了 bullet；
 * 此时把每条拆成独立的人物条目，群名本身不产生条目。返回是否已按「成员名单」处理。
 */
function splitMemberEntries(section: Section, b: Builder): boolean {
  const kvs = keyValueLines(section.lines);
  if (kvs.length === 0) return false;
  if (kvs.some((kv) => CHARACTER_FIELD.test(kv.key))) return false;
  for (const kv of kvs) {
    if (!isValid(kv.key)) continue;
    b.add({
      category: "character",
      key: `char:${kv.key}`,
      title: kv.key,
      content: kv.value.replace(REF_PAREN, "").trim(),
      status: parseStatus(kv.value),
      refs: mergeRefs(kv.value),
    });
  }
  return true;
}

function addCharacter(section: Section, b: Builder): void {
  const name = section.title;
  const knowledgeField: [string, KnowledgeRelation][] = [
    ["已知", "known"],
    ["误信", "misbelieved"],
    ["未知", "unknown"],
  ];
  const contentFields: [string, string][] = [];
  const knowledge: ParsedKnowledge[] = [];
  const refTexts: string[] = [];

  for (const { key, value } of keyValueLines(section.lines)) {
    const mapped = knowledgeField.find(([label]) => key.includes(label));
    if (mapped) {
      for (const item of splitList(value)) {
        knowledge.push({ characterName: name, infoItem: item, relation: mapped[1] });
      }
      refTexts.push(value);
      continue;
    }
    if (/证据|出处|依据/.test(key)) {
      refTexts.push(value);
      continue;
    }
    contentFields.push([key, value.replace(REF_PAREN, "").trim()]);
  }

  b.addKnowledge(knowledge);
  b.add({
    category: "character",
    key: `char:${name}`,
    title: name,
    content: joinFields(contentFields),
    status: parseStatus(section.lines.join("\n")),
    refs: mergeRefs(...refTexts),
  });
}

function parseTimeline(sections: Section[], b: Builder): void {
  for (const section of sections) {
    const uncertain = /存疑|冲突|未明/.test(section.title);
    const tables = parseTables(section.lines);

    for (const table of tables) {
      const timeCol = columnIndex(table.header, ["故事内时间", "时间"]);
      const eventCol = columnIndex(table.header, ["事件", "说明"]);
      const placeCol = columnIndex(table.header, ["地点", "位置"]);
      const noteCol = columnIndex(table.header, ["备注", "说明"]);
      if (eventCol < 0 && timeCol < 0) continue;
      for (const row of table.rows) {
        const event = eventCol >= 0 ? row[eventCol] ?? "" : row[timeCol] ?? "";
        const time = timeCol >= 0 ? row[timeCol] ?? "" : "";
        if (!isValid(event) && !isValid(time)) continue;
        const lead = [time, event].filter(isValid).join(" · ");
        b.add({
          category: "timeline",
          key: `tl:${clip(lead || event, 100)}`,
          title: clip(event || time, TITLE_MAX),
          content:
            joinFields([
              ["故事内时间", time],
              ["地点", placeCol >= 0 ? row[placeCol] ?? "" : ""],
              ["备注", noteCol >= 0 ? row[noteCol] ?? "" : ""],
            ]) || lead,
          status: parseStatus(row.join(" ")) ?? (uncertain ? "uncertain" : "confirmed"),
          refs: mergeRefs(...rowOf(table, row, /出处|章节/)),
        });
      }
    }

    if (tables.length > 0) continue;
    for (const bullet of bulletLines(section.lines)) {
      const [text, annotation = ""] = bullet.split(/\s*(?:——|--|—)\s*/, 2);
      if (!isValid(text)) continue;
      b.add({
        category: "timeline",
        key: `tl:${clip(text, 100)}`,
        title: clip(text, TITLE_MAX),
        content: [text, annotation].filter(isValid).join("\n"),
        status: parseStatus(annotation) ?? (uncertain ? "uncertain" : "confirmed"),
        refs: mergeRefs(bullet),
      });
    }
  }
}

function parseOpenThreads(sections: Section[], b: Builder): void {
  for (const section of sections) {
    const resolved = /已回收|已解决|回收/.test(section.title);
    const pending = /待用户|待定|未决/.test(section.title);
    const tables = parseTables(section.lines);

    for (const table of tables) {
      const threadCol = columnIndex(table.header, ["线索", "问题", "悬念"]);
      const stateCol = columnIndex(table.header, ["状态"]);
      if (threadCol < 0) continue;
      const fromCol = columnIndex(table.header, ["首现", "埋设处", "首次"]);
      const thenCol = columnIndex(table.header, ["后续发展", "回收处", "发展"]);
      const linkCol = columnIndex(table.header, ["可能关联", "关联"]);
      const noteCol = columnIndex(table.header, ["说明", "备注"]);
      for (const row of table.rows) {
        const title = row[threadCol] ?? "";
        if (!isValid(title)) continue;
        b.add({
          category: "thread",
          key: `thread:${title}`,
          title: clip(title, TITLE_MAX),
          content:
            joinFields([
              ["首现", fromCol >= 0 ? row[fromCol] ?? "" : ""],
              ["后续发展", thenCol >= 0 ? row[thenCol] ?? "" : ""],
              ["可能关联", linkCol >= 0 ? row[linkCol] ?? "" : ""],
              ["说明", noteCol >= 0 ? row[noteCol] ?? "" : ""],
            ]) || title,
          status: parseStatus(stateCol >= 0 ? row[stateCol] : undefined) ?? (resolved ? "resolved" : "open"),
          refs: mergeRefs(
            fromCol >= 0 ? row[fromCol] : undefined,
            thenCol >= 0 ? row[thenCol] : undefined,
          ),
        });
      }
    }

    if (tables.length > 0) continue;
    for (const bullet of bulletLines(section.lines)) {
      const [text, annotation = ""] = bullet.split(/\s*(?:——|--|—)\s*/, 2);
      if (!isValid(text)) continue;
      b.add({
        category: "thread",
        key: `thread:${clip(text, 120)}`,
        title: clip(text, TITLE_MAX),
        content: [text, annotation].filter(isValid).join("\n"),
        status: parseStatus(annotation) ?? (resolved ? "resolved" : pending ? "uncertain" : "open"),
        refs: mergeRefs(bullet),
      });
    }
  }
}

function parseStyleGuide(sections: Section[], b: Builder): void {
  for (const section of sections) {
    if (section.level < 2 || !isValid(section.title)) continue;
    const bullets = bulletLines(section.lines);
    const content = bullets.join("\n") || joinFields(keyValueLines(section.lines).map((kv) => [kv.key, kv.value]));
    if (!isValid(content) || bullets.length === 0) continue;
    const explicit = parseStatus(content);
    b.add({
      category: "style",
      key: `style:${section.title}`,
      title: section.title,
      content,
      status: explicit === "confirmed" ? "confirmed" : "inferred",
      refs: mergeRefs(content),
    });
  }
}

function parseOutline(sections: Section[], b: Builder): void {
  let parent = "";
  for (const section of sections) {
    if (section.level === 2) {
      parent = section.title;
      if (/章纲/.test(parent)) continue;
      if (!isValid(parent)) continue;
      const bullets = bulletLines(section.lines);
      const content =
        joinFields(keyValueLines(section.lines).map((kv) => [kv.key, kv.value])) || bullets.join("\n");
      if (!isValid(content)) continue;
      b.add({ category: "outline", key: `outline:${parent}`, title: parent, content });
      continue;
    }
    if (section.level !== 3 || !isValid(section.title)) continue;
    const content =
      joinFields(keyValueLines(section.lines).map((kv) => [kv.key, kv.value])) ||
      bulletLines(section.lines).join("\n");
    if (!isValid(content)) continue;
    b.add({
      category: "outline",
      key: `outline:${section.title}`,
      title: section.title,
      content,
    });
  }
}

/** 通用「表格 → 记忆条目」映射：按表头文字取标题/状态/出处列。 */
function addSimpleTable(
  b: Builder,
  category: MemoryCategory,
  table: Table,
  opts: {
    titleCols: string[];
    statusCols: string[];
    refCols: string[];
    keyPrefix: string;
  },
): void {
  const titleCol = columnIndex(table.header, opts.titleCols);
  const statusCol = columnIndex(table.header, opts.statusCols);
  const refCol = columnIndex(table.header, opts.refCols);
  const detailCol = columnIndex(table.header, ["内容", "说明", "详情", "描述"]);
  if (titleCol < 0) return;
  for (const row of table.rows) {
    const title = row[titleCol] ?? "";
    if (!isValid(title)) continue;
    const detail = detailCol >= 0 ? row[detailCol] ?? "" : "";
    b.add({
      category,
      key: `${opts.keyPrefix}:${title}`,
      title: clip(title, TITLE_MAX),
      content: detail || title,
      status: parseStatus(statusCol >= 0 ? row[statusCol] : undefined),
      refs: mergeRefs(refCol >= 0 ? row[refCol] : undefined),
    });
  }
}

/** 取表中匹配某列名集合的单元格（用于合并多列出处）。 */
function rowOf(table: Table, row: string[], pattern: RegExp): (string | undefined)[] {
  return table.header.map((h, i) => (pattern.test(h ?? "") ? row[i] : undefined));
}
