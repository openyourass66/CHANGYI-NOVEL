import { CHAPTER_FLAG, type ChapterFlag } from "@/lib/domain";
import { NUMBER_CHARS, parseNumber } from "./numerals";

export type DetectedChapter = {
  rawTitle: string;
  volumeNumber: number | null;
  volumeTitle: string | null;
  normalizedIndex: number;
  content: string;
  startOffset: number;
  endOffset: number;
  confidence: number;
  flags: ChapterFlag[];
};

export type ParseStats = {
  total: number;
  withNumber: number;
  missingNumbers: number[];
  duplicateNumbers: number[];
  outOfOrder: boolean;
  volumes: number;
};

export type DetectResult = {
  chapters: DetectedChapter[];
  stats: ParseStats;
};

const SPECIAL_WORDS = [
  "楔子",
  "序章",
  "序言",
  "序",
  "引言",
  "引子",
  "前言",
  "尾声",
  "尾聲",
  "后记",
  "後記",
  "番外",
  "终章",
  "終章",
  "大结局",
  "大結局",
];

const CHAPTER_RE = new RegExp(
  `^\\s*第\\s*([${NUMBER_CHARS}]{1,8})\\s*([章回节節])\\s*[:：、.．\\-—]?\\s*(.{0,40})$`,
);
const VOLUME_RE = new RegExp(
  `^\\s*第\\s*([${NUMBER_CHARS}]{1,8})\\s*([卷部篇])\\s*[:：、.．\\-—]?\\s*(.{0,40})$`,
);
const SPECIAL_RE = new RegExp(
  `^\\s*(${SPECIAL_WORDS.join("|")})\\s*[:：、.．\\-—]?\\s*(.{0,40})$`,
);
const MD_HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*$/;

type HeadingKind = "chapter" | "volume" | "special" | "md" | null;

type LineInfo = { text: string; start: number };

function classify(line: string): {
  kind: HeadingKind;
  number: number | null;
  title: string;
  confidence: number;
} {
  const md = MD_HEADING_RE.exec(line);
  if (md) {
    const title = md[2].replace(/\s*#+\s*$/, "").trim();
    // Markdown 标题若形如「第X章」按章节处理
    const inner = classify(title);
    if (inner.kind === "chapter" || inner.kind === "volume" || inner.kind === "special") {
      return inner;
    }
    return { kind: "md", number: null, title, confidence: 0.6 };
  }

  const ch = CHAPTER_RE.exec(line);
  if (ch) {
    const num = parseNumber(ch[1]);
    return {
      kind: "chapter",
      number: num,
      title: (ch[3] ?? "").trim(),
      confidence: num == null ? 0.5 : 1,
    };
  }

  const vol = VOLUME_RE.exec(line);
  if (vol) {
    const num = parseNumber(vol[1]);
    return {
      kind: "volume",
      number: num,
      title: (vol[3] ?? "").trim(),
      confidence: num == null ? 0.5 : 1,
    };
  }

  const sp = SPECIAL_RE.exec(line);
  if (sp) {
    return { kind: "special", number: null, title: (sp[2] ?? "").trim(), confidence: 0.9 };
  }

  return { kind: null, number: null, title: "", confidence: 0 };
}

function splitLines(text: string): LineInfo[] {
  const out: LineInfo[] = [];
  let offset = 0;
  for (const text2 of text.split("\n")) {
    out.push({ text: text2, start: offset });
    offset += text2.length + 1; // +1 为换行符
  }
  return out;
}

/**
 * 从纯文本识别章节。不静默纠正缺号/重号/乱序——只标注，交由用户确认。
 * 保留标题前的卷首文本，避免丢失素材。
 */
export function detectChapters(text: string): DetectResult {
  const lines = splitLines(text);
  const heads: { lineIdx: number; kind: HeadingKind; number: number | null; title: string; raw: string; confidence: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].text;
    if (!raw.trim()) continue;
    // 章节标题不应过长
    if (raw.trim().length > 60) continue;

    const c = classify(raw);
    if (!c.kind) continue;

    // 卷标题仅记录卷上下文，自身不作为章节
    if (c.kind === "volume") continue;

    heads.push({
      lineIdx: i,
      kind: c.kind,
      number: c.number,
      title: c.title,
      raw: raw.trim(),
      confidence: c.confidence,
    });
  }

  const chapters: DetectedChapter[] = [];

  // 章节标题之前的卷首文本
  const firstHeadLine = heads[0]?.lineIdx ?? lines.length;
  if (firstHeadLine > 0) {
    const frontText = lines
      .slice(0, firstHeadLine)
      .map((l) => l.text)
      .join("\n")
      .trim();
    if (frontText.length > 0) {
      chapters.push({
        rawTitle: "卷首",
        volumeNumber: null,
        volumeTitle: null,
        normalizedIndex: 0,
        content: frontText,
        startOffset: 0,
        endOffset: lines[firstHeadLine]?.start ?? text.length,
        confidence: 0.5,
        flags: ["uncertain-boundary"],
      });
    }
  }

  // 为 heads 计算所属卷：再次按行序扫描，记录每个标题行处的当前卷
  const volByLine: { lineIdx: number; num: number | null; title: string | null }[] = [];
  {
    let num: number | null = null;
    let title: string | null = null;
    const volHeads = new Map<number, { num: number | null; title: string | null }>();
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].text;
      if (!raw.trim() || raw.trim().length > 60) continue;
      const c = classify(raw);
      if (c.kind === "volume") {
        num = c.number;
        title = c.title || null;
      }
      volHeads.set(i, { num, title });
    }
    for (const h of heads) {
      const v = volHeads.get(h.lineIdx);
      volByLine.push({ lineIdx: h.lineIdx, num: v?.num ?? null, title: v?.title ?? null });
    }
  }

  for (let k = 0; k < heads.length; k++) {
    const h = heads[k];
    const next = heads[k + 1];
    const titleLine = lines[h.lineIdx];
    const contentStartLine = h.lineIdx + 1;
    const contentEndLine = next ? next.lineIdx : lines.length;

    const content = lines
      .slice(contentStartLine, contentEndLine)
      .map((l) => l.text)
      .join("\n")
      .replace(/^\s*\n+/, "")
      .replace(/\n+\s*$/, "");

    const volInfo = volByLine[k];
    const displayTitle = h.title
      ? `${h.raw.split(/\s+/)[0]} ${h.title}`.trim()
      : h.raw;

    const flags: ChapterFlag[] = [];
    if (content.trim().length === 0) flags.push("empty");

    chapters.push({
      rawTitle: displayTitle || h.raw,
      volumeNumber: volInfo.num,
      volumeTitle: volInfo.title,
      normalizedIndex: h.number ?? 0,
      content,
      startOffset: titleLine.start,
      endOffset: next ? lines[next.lineIdx].start : text.length,
      confidence: h.confidence,
      flags,
    });
  }

  // 无编号章节（楔子/序章等）保留 normalizedIndex = 0，仅以文档顺序排列；
  // 不参与缺号/重号/乱序判定，避免与真实编号冲突产生假阳性。
  const stats = computeStats(chapters);
  return { chapters, stats };
}

function computeStats(chapters: DetectedChapter[]): ParseStats {
  const numbered = chapters.filter((c) => c.normalizedIndex > 0);
  const seen = new Map<number, number>();
  for (const c of numbered) {
    seen.set(c.normalizedIndex, (seen.get(c.normalizedIndex) ?? 0) + 1);
  }

  const duplicateNumbers: number[] = [];
  for (const [num, count] of seen) {
    if (count > 1) duplicateNumbers.push(num);
  }

  const uniqueSorted = [...seen.keys()].sort((a, b) => a - b);
  const missingNumbers: number[] = [];
  for (let i = 1; i < uniqueSorted.length; i++) {
    const prev = uniqueSorted[i - 1];
    const cur = uniqueSorted[i];
    for (let n = prev + 1; n < cur; n++) missingNumbers.push(n);
  }

  // 乱序：文档顺序中的编号序列是否单调不减
  let outOfOrder = false;
  let last = -Infinity;
  for (const c of numbered) {
    if (c.normalizedIndex < last) {
      outOfOrder = true;
      break;
    }
    last = c.normalizedIndex;
  }

  // 标注 flags
  for (const c of chapters) {
    if (c.normalizedIndex > 0 && duplicateNumbers.includes(c.normalizedIndex)) {
      if (!c.flags.includes("duplicate-number")) c.flags.push("duplicate-number");
    }
    if (c.confidence < 0.7 && !c.flags.includes("uncertain-boundary")) {
      c.flags.push("uncertain-boundary");
    }
  }

  // 乱序章节整体标注
  if (outOfOrder) {
    for (const c of chapters) {
      if (c.normalizedIndex > 0 && !c.flags.includes("out-of-order")) {
        c.flags.push("out-of-order");
      }
    }
  }

  // 缺号：标注缺口前的那一章（按其序号）
  if (missingNumbers.length > 0) {
    const missingSet = new Set(missingNumbers);
    for (const c of chapters) {
      if (c.normalizedIndex > 0 && missingSet.has(c.normalizedIndex + 1)) {
        if (!c.flags.includes("missing-number")) c.flags.push("missing-number");
      }
    }
  }

  const volumes = new Set(
    chapters.map((c) => c.volumeNumber).filter((v): v is number => v != null),
  ).size;

  return {
    total: chapters.length,
    withNumber: numbered.length,
    missingNumbers,
    duplicateNumbers,
    outOfOrder,
    volumes,
  };
}

/** 无任何标题时：整篇作为单章，交由用户手工切分。 */
export function fallbackSingleChapter(text: string): DetectedChapter[] {
  return [
    {
      rawTitle: "全文（未识别到章节标题）",
      volumeNumber: null,
      volumeTitle: null,
      normalizedIndex: 1,
      content: text.trim(),
      startOffset: 0,
      endOffset: text.length,
      confidence: 0.3,
      flags: ["no-title", "uncertain-boundary"],
    },
  ];
}

export function flagLabel(flag: string): string {
  return (CHAPTER_FLAG as Record<string, string>)[flag] ?? flag;
}
