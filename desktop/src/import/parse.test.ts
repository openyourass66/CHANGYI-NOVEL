import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { parseDocument } from "./parse";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("document import without Node runtime", () => {
  it("preserves chapter boundaries, Chinese numbering, and UTF-16 offsets", async () => {
    const doc = await parseDocument(bytes("第一章 开始\r\n甲😀乙\r\n\r\n第三章 回来\r\n丙丁"), "小说.txt");
    expect(doc.chapters).toHaveLength(2);
    expect(doc.chapters[0].content).toBe("甲😀乙");
    expect(doc.chapters[0].flags).toContain("missing-number");
    expect(doc.chapters[1].startOffset).toBe("第一章 开始\n甲😀乙\n\n".length);
  });
  it("uses a single readable chapter for text without headings", async () => {
    const doc = await parseDocument(bytes("普通文本，没有章节标题。"), "小说.md");
    expect(doc.chapters).toHaveLength(1);
    expect(doc.chapters[0].content).toContain("普通文本");
  });
  it("decodes GBK Chinese text", async () => {
    const doc = await parseDocument(new Uint8Array([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 10, 0xd6, 0xd0, 0xce, 0xc4, 0xd0, 0xa1, 0xcb, 0xb5]), "小说.txt");
    expect(doc.chapters[0].content).toBe("中文小说");
  });
  it("removes HTML scripts and retains paragraph boundaries", async () => {
    const doc = await parseDocument(bytes("<html><head><title>忽略</title></head><body><h1>第一章</h1><p>段落甲</p><p>段落乙</p><script>忽略脚本</script></body></html>"), "小说.html");
    expect(doc.chapters[0].content).toBe("段落甲\n段落乙");
  });
  it("respects EPUB spine order and relative archive paths", async () => {
    const zip = new JSZip();
    zip.file("META-INF/container.xml", '<container><rootfile full-path="OPS/book.opf"/></container>');
    zip.file("OPS/book.opf", '<package><manifest><item id="second" href="text/b.html"/><item id="first" href="text/a.html"/></manifest><spine><itemref idref="first"/><itemref idref="second"/></spine></package>');
    zip.file("OPS/text/a.html", "<h1>第一章</h1><p>先到这里</p>");
    zip.file("OPS/text/b.html", "<h1>第二章</h1><p>后到这里</p>");
    const doc = await parseDocument(await zip.generateAsync({ type: "uint8array" }), "小说.epub");
    expect(doc.chapters.map((c) => c.content)).toEqual(["先到这里", "后到这里"]);
  });
  it("extracts DOCX text using the browser parser", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>第一章</w:t></w:r></w:p><w:p><w:r><w:t>正文内容</w:t></w:r></w:p></w:body></w:document>');
    const doc = await parseDocument(await zip.generateAsync({ type: "uint8array" }), "小说.docx");
    expect(doc.chapters[0].content).toBe("正文内容");
  });
  it("rejects empty and unsupported files", async () => {
    await expect(parseDocument(new Uint8Array(), "空.txt")).rejects.toThrow("文件为空");
    await expect(parseDocument(bytes("hello"), "程序.exe")).rejects.toThrow("不支持");
  });
});
