import chardet from "chardet";
import iconv from "iconv-lite";

/** 探测编码并解码。中文统一用 gb18030，兼容 GB2312/GBK。 */
export function decodeBuffer(buffer: Buffer): { text: string; encoding: string } {
  let detected = "UTF-8";
  try {
    detected = chardet.detect(buffer) ?? "UTF-8";
  } catch {
    detected = "UTF-8";
  }
  const lower = detected.toLowerCase();
  const encoding = lower.includes("big5")
    ? "big5"
    : /gb/.test(lower)
      ? "gb18030"
      : detected;

  if (!iconv.encodingExists(encoding)) {
    return { text: buffer.toString("utf8"), encoding: "UTF-8(回退)" };
  }
  return { text: iconv.decode(buffer, encoding), encoding: encoding.toUpperCase() };
}

/** 供非文本容器（HTML/XML）复用的解码入口。 */
export async function parseMarkdownLikeEncoding(buffer: Buffer) {
  return decodeBuffer(buffer);
}
