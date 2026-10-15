import mammoth from "mammoth";
import { normalizeText, type Parser } from "./types";

export const parseDocx: Parser = async ({ buffer }) => {
  const result = await mammoth.extractRawText({ buffer });
  const warnings = result.messages
    .filter((m) => m.type === "warning" || m.type === "error")
    .map((m) => `DOCX 解析提示：${m.message}`);
  return {
    text: normalizeText(result.value),
    warnings: [...warnings, "DOCX 版式可能影响定位，请核对章节切分结果。"],
  };
};
