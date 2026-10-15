import JSZip from "jszip";
import { htmlToText } from "./html";
import { normalizeText, type Parser } from "./types";

function resolvePath(baseDir: string, href: string): string {
  const cleaned = decodeURIComponent(href).replace(/^\.\//, "").replace(/^\//, "");
  if (!baseDir) return cleaned;
  // 处理 ../ 回退
  const segments = (baseDir + cleaned).split("/");
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === "..") out.pop();
    else if (seg !== "." && seg !== "") out.push(seg);
  }
  return out.join("/");
}

export const parseEpub: Parser = async ({ buffer }) => {
  const zip = await JSZip.loadAsync(buffer);

  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) throw new Error("EPUB 结构异常：缺少 META-INF/container.xml。");
  const containerXml = await containerFile.async("string");
  const opfPath = /<rootfile[^>]*full-path="([^"]+)"/.exec(containerXml)?.[1];
  if (!opfPath) throw new Error("EPUB 结构异常：未找到 OPF 清单路径。");

  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error("EPUB 结构异常：OPF 文件缺失。");
  const opf = await opfFile.async("string");

  const baseDir = opfPath.includes("/")
    ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1)
    : "";

  const manifest = new Map<string, string>();
  for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
    const tag = m[0];
    const id = /\bid="([^"]+)"/.exec(tag)?.[1];
    const href = /\bhref="([^"]+)"/.exec(tag)?.[1];
    if (id && href) manifest.set(id, href);
  }

  const spineIds = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)].map((m) => m[1]);
  const order = spineIds.length ? spineIds : [...manifest.keys()];

  const parts: string[] = [];
  for (const id of order) {
    const href = manifest.get(id);
    if (!href) continue;
    const path = resolvePath(baseDir, href);
    const file = zip.file(path) ?? zip.file(href);
    if (!file) continue;
    const raw = await file.async("string");
    const text = htmlToText(raw).trim();
    if (text) parts.push(text);
  }

  if (parts.length === 0) throw new Error("EPUB 未解析到正文内容。");

  return {
    text: normalizeText(parts.join("\n\n")),
    warnings: ["EPUB 版式与分章可能影响定位，请核对章节切分结果。"],
    meta: { spineCount: order.length },
  };
};
