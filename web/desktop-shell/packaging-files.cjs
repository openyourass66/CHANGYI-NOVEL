const { readdir, realpath, stat, unlink } = require("node:fs/promises");
const path = require("node:path");

/** @param {string} file */
function isReleaseFile(file) {
  const name = path.basename(file);
  return !name.endsWith(".map") && !/^(?:lib)?query_engine-.+\.tmp\d*$/i.test(name);
}

/** 只清理构建产物中的文件，不沿目录链接访问构建目录之外的内容。
 * @param {string} directory
 */
async function pruneReleaseFiles(directory) {
  const root = await realpath(directory);
  const removed = { files: 0, bytes: 0 };
  /** @param {string} current */
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(current, entry.name);
      const relative = path.relative(root, file);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`拒绝清理构建目录之外的文件：${file}`);
      }
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && !isReleaseFile(file)) {
        const size = (await stat(file)).size;
        await unlink(file);
        removed.files += 1;
        removed.bytes += size;
      }
    }
  }
  await visit(root);
  return removed;
}

module.exports = { isReleaseFile, pruneReleaseFiles };
