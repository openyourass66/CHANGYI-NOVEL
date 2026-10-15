import { mkdir } from "node:fs/promises";
import path from "node:path";

/** 本机数据目录：默认 <web>/data，可由 NOVEL_DATA_DIR 覆盖。 */
export const DATA_DIR =
  path.resolve(/* turbopackIgnore: true */ process.env.NOVEL_DATA_DIR ?? path.join(process.cwd(), "data"));

export function projectDir(projectId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error("项目标识无效。");
  return path.join(/* turbopackIgnore: true */ DATA_DIR, "projects", projectId);
}

export function projectSourcesDir(projectId: string) {
  return path.join(projectDir(projectId), "sources");
}

export function projectExportsDir(projectId: string) {
  return path.join(projectDir(projectId), "exports");
}

export async function ensureProjectDirs(projectId: string) {
  await mkdir(projectSourcesDir(projectId), { recursive: true });
  await mkdir(projectExportsDir(projectId), { recursive: true });
}

/** 保存相对路径，便于项目整体迁移；读取时再拼回 DATA_DIR。 */
export function toStoredPath(absolutePath: string) {
  const relative = path.relative(DATA_DIR, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("文件路径超出存储目录。");
  return relative.split(path.sep).join("/");
}

export function fromStoredPath(storedPath: string) {
  if (!storedPath || storedPath.includes("\\") || path.isAbsolute(storedPath)) throw new Error("文件路径无效。");
  const resolved = path.resolve(/* turbopackIgnore: true */ DATA_DIR, storedPath);
  toStoredPath(resolved);
  return resolved;
}
