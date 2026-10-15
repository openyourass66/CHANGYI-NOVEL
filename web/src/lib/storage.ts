import { mkdir } from "node:fs/promises";
import path from "node:path";

/** 本机数据目录：默认 <web>/data，可由 NOVEL_DATA_DIR 覆盖。 */
export const DATA_DIR =
  process.env.NOVEL_DATA_DIR ?? path.join(process.cwd(), "data");

export function projectDir(projectId: string) {
  return path.join(DATA_DIR, "projects", projectId);
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
  return path.relative(DATA_DIR, absolutePath).split(path.sep).join("/");
}

export function fromStoredPath(storedPath: string) {
  return path.join(DATA_DIR, ...storedPath.split("/"));
}
