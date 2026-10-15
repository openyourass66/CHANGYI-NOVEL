import * as cheerio from "cheerio";
import { decodeBuffer } from "./encoding";
import { normalizeText, type Parser } from "./types";

const BLOCK_TAGS =
  "p,div,h1,h2,h3,h4,h5,h6,li,tr,section,article,header,footer,blockquote,pre,figcaption,br,hr";

/** 将 HTML 转为保留块级换行的纯文本（用于章节定位）。 */
export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $("script,style,noscript,template,head,title,meta,link").remove();

  type Mutable = {
    append: (content: string) => void;
    replaceWith: (content: string) => void;
  };
  for (const el of $(BLOCK_TAGS).toArray()) {
    const tag = el.tagName;
    const node = $(el) as unknown as Mutable;
    if (tag === "br" || tag === "hr") {
      node.replaceWith("\n");
    } else {
      node.append("\n");
    }
  }

  const root = ($("body").length ? $("body") : $.root()) as unknown as {
    text: () => string;
  };
  return root.text();
}

export const parseHtml: Parser = async ({ buffer }) => {
  const { text, encoding } = decodeBuffer(buffer);
  return {
    text: normalizeText(htmlToText(text)),
    encoding,
    warnings: ["HTML 版式可能影响定位，请核对章节切分结果。"],
  };
};
