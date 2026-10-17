import { detectFormat, MAX_FILE_BYTES } from "@/lib/import/formats";
import { detectChapters, fallbackSingleChapter } from "@/lib/import/chapter-detect";
import { normalizeText } from "@/lib/import/parsers/types";

function decode(bytes: Uint8Array): { text: string; encoding: string } {
  // 优先确定 UTF-8，避免中文短文本被编码探测器误判。
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "UTF-8" }; }
  catch { /* 非 UTF-8 文本进入编码探测。 */ }
  return { text: "", encoding: "" };
}

async function decodeText(bytes: Uint8Array) {
  const utf8 = decode(bytes);
  if (utf8.encoding) return utf8;
  const { default: detector } = await import("jschardet");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const detected = detector.detect(binary).encoding ?? "UTF-8";
  const encoding = /gb/i.test(detected) ? "gb18030" : detected;
  try { return { text: new TextDecoder(encoding).decode(bytes), encoding: encoding.toUpperCase() }; }
  catch { return { text: new TextDecoder().decode(bytes), encoding: "UTF-8(回退)" }; }
}

async function htmlText(html: string) {
  const { load } = await import("cheerio/slim");
  const $ = load(html);
  $("script,style,noscript,template,head,title,meta,link").remove();
  for (const node of $("p,div,h1,h2,h3,h4,h5,h6,li,tr,section,article,header,footer,blockquote,pre,figcaption,br,hr").toArray()) {
    if (node.tagName === "br" || node.tagName === "hr") $(node).replaceWith("\n");
    else $(node).append("\n");
  }
  return $("body").length ? $("body").text() : $.root().text();
}

function resolveArchivePath(base: string, href: string) {
  const segments = `${base}${decodeURIComponent(href).replace(/^\//, "")}`.split("/");
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "..") out.pop();
    else if (segment !== "." && segment !== "") out.push(segment);
  }
  return out.join("/");
}

export async function parseDocument(bytes: Uint8Array, fileName: string) {
  if (!bytes.length) throw new Error("文件为空。");
  if (bytes.length > MAX_FILE_BYTES) throw new Error("单文件不得超过 50MB。");
  const format = detectFormat(fileName);
  if (!format) throw new Error("不支持的文件格式。");
  let text = "";
  let encoding: string | null = null;
  const warnings: string[] = [];

  if (format === "txt" || format === "markdown" || format === "html") {
    const decoded = await decodeText(bytes);
    encoding = decoded.encoding;
    text = format === "html" ? await htmlText(decoded.text) : decoded.text;
    if (format === "html") warnings.push("HTML 版式可能影响定位，请核对章节切分结果。");
  } else if (format === "docx") {
    const { default: mammoth } = await import("mammoth/mammoth.browser");
    const result = await mammoth.extractRawText({ arrayBuffer: bytes.slice().buffer });
    text = result.value;
    warnings.push(...result.messages.map((m) => `DOCX 解析提示：${m.message}`), "DOCX 版式可能影响定位，请核对章节切分结果。");
  } else if (format === "epub") {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(bytes);
    const container = await zip.file("META-INF/container.xml")?.async("string");
    const opfPath = /<rootfile[^>]*full-path=["']([^"']+)["']/.exec(container ?? "")?.[1];
    if (!opfPath) throw new Error("EPUB 结构异常：未找到 OPF 清单路径。");
    const opf = await zip.file(opfPath)?.async("string");
    if (!opf) throw new Error("EPUB 结构异常：OPF 文件缺失。");
    const manifest = new Map<string, string>();
    for (const match of opf.matchAll(/<item\b[^>]*>/g)) {
      const id = /\bid=["']([^"']+)["']/.exec(match[0])?.[1];
      const href = /\bhref=["']([^"']+)["']/.exec(match[0])?.[1];
      if (id && href) manifest.set(id, href);
    }
    const spine = [...opf.matchAll(/<itemref\b[^>]*\bidref=["']([^"']+)["']/g)].map((m) => m[1]);
    const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
    const parts: string[] = [];
    let expandedBytes = 0;
    for (const id of spine.length ? spine : [...manifest.keys()]) {
      const href = manifest.get(id);
      if (!href) continue;
      const file = zip.file(resolveArchivePath(base, href)) ?? zip.file(href);
      if (!file) continue;
      const raw = await file.async("string");
      expandedBytes += raw.length;
      if (expandedBytes > 100 * 1024 * 1024) throw new Error("EPUB 解压后的正文过大。");
      const part = (await htmlText(raw)).trim();
      if (part) parts.push(part);
    }
    if (!parts.length) throw new Error("EPUB 未解析到正文内容。");
    text = parts.join("\n\n");
    warnings.push("EPUB 版式与分章可能影响定位，请核对章节切分结果。");
  } else if (format === "pdf") {
    const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
    const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const loadingTask = pdfjs.getDocument({
      data: bytes.slice(),
      cMapUrl: new URL("/pdfjs/cmaps/", globalThis.location.origin).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("/pdfjs/standard_fonts/", globalThis.location.origin).href,
      wasmUrl: new URL("/pdfjs/wasm/", globalThis.location.origin).href,
      iccUrl: new URL("/pdfjs/iccs/", globalThis.location.origin).href,
      useSystemFonts: false,
    });
    const doc = await loadingTask.promise;
    try {
      const parts: string[] = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        let line = "";
        for (const item of content.items) if ("str" in item) line += item.str + (item.hasEOL ? "\n" : "");
        parts.push(line);
        page.cleanup();
      }
      text = parts.join("\n\n");
    } finally { await loadingTask.destroy(); }
    if (text.replace(/\s/g, "").length < 20) throw new Error("该 PDF 未提取到可用文本，可能是扫描版；暂不支持 OCR。");
    warnings.push("PDF 版式（分页、分栏）可能影响定位，请核对章节切分结果。");
  }
  text = normalizeText(text);
  if (!text) throw new Error("未提取到可用正文。");
  const detected = detectChapters(text);
  return {
    fileName, format, encoding, warnings,
    chapters: detected.chapters.length ? detected.chapters : fallbackSingleChapter(text),
    stats: detected.stats,
  };
}
