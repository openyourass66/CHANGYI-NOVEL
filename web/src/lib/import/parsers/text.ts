import { decodeBuffer } from "./encoding";
import { normalizeText, type Parser } from "./types";

export const parseTxt: Parser = async ({ buffer }) => {
  const { text, encoding } = decodeBuffer(buffer);
  return { text: normalizeText(text), encoding, warnings: [] };
};

export const parseMarkdown: Parser = async ({ buffer }) => {
  const { text, encoding } = decodeBuffer(buffer);
  return {
    text: normalizeText(text),
    encoding,
    warnings: ["Markdown 标题层级将用于章节识别，请核对解析结果。"],
  };
};
