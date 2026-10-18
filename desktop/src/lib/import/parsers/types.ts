import type { ImportFormat } from "@/lib/domain";

export type ParserInput = {
  buffer: Buffer;
  fileName: string;
};

export type ParsedDocument = {
  /** 归一化后的纯文本（\n 换行，已去 BOM） */
  text: string;
  encoding?: string;
  /** 影响定位的解析提示，展示给用户确认 */
  warnings: string[];
  meta?: Record<string, unknown>;
};

export type Parser = (input: ParserInput) => Promise<ParsedDocument>;

export type ParserRegistry = Partial<Record<ImportFormat, Parser>>;

/** 统一换行符、去 BOM、压缩过多空行。 */
export function normalizeText(input: string): string {
  const withoutBom = input.replace(/^﻿/, "");
  const unified = withoutBom.replace(/\r\n?/g, "\n");
  // 压缩连续空行为最多两行
  const lines = unified.split("\n").map((l) => l.replace(/[ \t]+$/g, ""));
  const out: string[] = [];
  let blanks = 0;
  for (const line of lines) {
    if (line.trim() === "") {
      blanks += 1;
      if (blanks <= 2) out.push("");
    } else {
      blanks = 0;
      out.push(line);
    }
  }
  return out.join("\n").trim();
}
