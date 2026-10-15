import { normalizeText, type Parser } from "./types";

/**
 * 仅支持可提取文本的 PDF。扫描版（无文本层）明确报错，不做 OCR。
 */
export const parsePdf: Parser = async ({ buffer }) => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    useWorkerFetch: false,
  }).promise;

  const parts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let line = "";
    for (const item of content.items) {
      if ("str" in item) {
        line += item.str;
        if (item.hasEOL) line += "\n";
      }
    }
    parts.push(line);
  }

  const text = normalizeText(parts.join("\n\n"));
  if (text.replace(/\s/g, "").length < 20) {
    throw new Error("该 PDF 未提取到可用文本，可能是扫描版；暂不支持 OCR。");
  }

  return {
    text,
    warnings: ["PDF 版式（分页、分栏）可能影响定位，请核对章节切分结果。"],
    meta: { pages: doc.numPages },
  };
};
