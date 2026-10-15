/**
 * 纯格式工具：不依赖 node 内置模块或解析器实现，可安全用于客户端组件。
 * 解析器注册表见 ./parsers。
 */
import { IMPORT_FORMAT, type ImportFormat } from "@/lib/domain";

export const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50MB

function extname(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

export function detectFormat(fileName: string): ImportFormat | null {
  const ext = extname(fileName);
  for (const [format, def] of Object.entries(IMPORT_FORMAT)) {
    if ((def.ext as readonly string[]).includes(ext)) return format as ImportFormat;
  }
  return null;
}

export function supportedExtensions(): string {
  return Object.values(IMPORT_FORMAT)
    .flatMap((d) => d.ext)
    .join(",");
}
