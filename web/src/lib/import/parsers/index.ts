import path from "node:path";
import type { ImportFormat } from "@/lib/domain";
import { detectFormat, MAX_FILE_BYTES, supportedExtensions } from "../formats";
import { parseDocx } from "./docx";
import { parseEpub } from "./epub";
import { parseHtml } from "./html";
import { parsePdf } from "./pdf";
import { parseMarkdown, parseTxt } from "./text";
import type { ParsedDocument, Parser, ParserRegistry } from "./types";

export type { ParsedDocument } from "./types";
export { detectFormat, MAX_FILE_BYTES, supportedExtensions };

/** 可扩展的解析器注册表：新增格式只需在此登记。 */
export const PARSERS: ParserRegistry = {
  txt: parseTxt,
  markdown: parseMarkdown,
  docx: parseDocx,
  html: parseHtml,
  epub: parseEpub,
  pdf: parsePdf,
};

export type ParseOutcome =
  | { ok: true; format: ImportFormat; doc: ParsedDocument }
  | { ok: false; format: ImportFormat | null; error: string };

export async function parseDocument(
  buffer: Buffer,
  fileName: string,
): Promise<ParseOutcome> {
  const format = detectFormat(fileName);
  if (!format) {
    return {
      ok: false,
      format: null,
      error: `暂不支持的文件格式：${path.extname(fileName) || "(无扩展名)"}。支持 ${supportedExtensions()}。`,
    };
  }
  if (buffer.byteLength === 0) {
    return { ok: false, format, error: "文件为空。" };
  }
  if (buffer.byteLength > MAX_FILE_BYTES) {
    return {
      ok: false,
      format,
      error: `文件过大（${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB），上限 50MB。`,
    };
  }

  const parser = PARSERS[format] as Parser | undefined;
  if (!parser) {
    return { ok: false, format, error: `格式 ${format} 的解析器尚未实现。` };
  }

  try {
    const doc = await parser({ buffer, fileName });
    if (!doc.text.trim()) {
      return { ok: false, format, error: "未能提取到文本内容。" };
    }
    return { ok: true, format, doc };
  } catch (error) {
    return {
      ok: false,
      format,
      error: error instanceof Error ? error.message : "解析失败。",
    };
  }
}
