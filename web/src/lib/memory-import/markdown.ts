/**
 * 记忆文档的 Markdown 分块工具：按标题分节、解析管道表格与 bullet 行。
 * 纯函数，供解析器复用；对模板中的占位内容保持宽容，不做语义判断。
 */

export type Section = { level: number; title: string; lines: string[] };
export type Table = { header: string[]; rows: string[][] };

const HEADING = /^(#{1,6})\s+(.*\S)\s*$/;
const BULLET = /^\s*[-*+]\s+(.*\S)\s*$/;
const KEY_VALUE = /^([^：:]{1,40})[：:]\s*(.*)$/;
const SEPARATOR_CELL = /^:?-{2,}:?$/;

/** 去掉反引号、粗体/斜体标记与首尾空白，便于比对状态与取值。 */
export function stripMarkup(text: string): string {
  return text
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 按 `#`~`######` 标题分节。标题前的内容归入 `{ level: 0, title: "" }` 一节。 */
export function parseSections(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { level: 0, title: "", lines: [] };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const m = HEADING.exec(raw);
    if (m) {
      if (current.lines.some((l) => l.trim()) || current.title) sections.push(current);
      current = { level: m[1].length, title: stripMarkup(m[2]), lines: [] };
      continue;
    }
    current.lines.push(raw);
  }
  if (current.lines.some((l) => l.trim()) || current.title) sections.push(current);
  return sections;
}

/** 去掉行内的标题标记，取标题文本（不含 `#`）。 */
export function headingText(line: string): string | null {
  const m = HEADING.exec(line);
  return m ? stripMarkup(m[2]) : null;
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.lastIndexOf("|") > 0;
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => SEPARATOR_CELL.test(c.replace(/\s/g, "")));
}

function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => stripMarkup(c));
}

/** 提取行区间内的所有管道表格；首行为表头，紧随的全分隔行被跳过，空行不产生行。 */
export function parseTables(lines: string[]): Table[] {
  const tables: Table[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isTableRow(lines[i])) {
      i++;
      continue;
    }
    const block: string[] = [];
    while (i < lines.length && isTableRow(lines[i])) {
      block.push(lines[i]);
      i++;
    }
    const parsed = block.map(splitRow).filter((cells) => !isSeparatorRow(cells));
    const [header, ...rows] = parsed;
    if (!header || header.length === 0) continue;
    const dataRows = rows.filter((cells) => cells.some((c) => c.length > 0));
    if (dataRows.length > 0) tables.push({ header, rows: dataRows });
  }
  return tables;
}

/** 命中表头中任一别名（模糊包含）的列下标，找不到返回 -1。 */
export function columnIndex(header: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const at = header.findIndex((h) => h && h.includes(alias));
    if (at >= 0) return at;
  }
  return -1;
}

/** 行区间内的 bullet 文本（已剥离标记与行内注解）。 */
export function bulletLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const m = BULLET.exec(line);
    if (m) out.push(stripMarkup(m[1]));
  }
  return out;
}

/** 行区间内形如 `- 字段：值` 的条目（`字段` 不含冒号，最多 40 字）。 */
export function keyValueLines(lines: string[]): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (const line of lines) {
    const m = BULLET.exec(line);
    if (!m) continue;
    const kv = KEY_VALUE.exec(stripMarkup(m[1]));
    if (!kv) continue;
    out.push({ key: kv[1].trim(), value: kv[2].trim() });
  }
  return out;
}
