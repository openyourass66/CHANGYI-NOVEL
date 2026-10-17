const assert = require("node:assert/strict");
const { test } = require("node:test");
const { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { isReleaseFile, pruneReleaseFiles } = require("./packaging-files.cjs");

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "changyi-packaging-"));
  t.after(async () => {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("changyi-packaging-")) {
      throw new Error("临时测试目录不在预期位置。");
    }
    await rm(root, { recursive: true, force: true });
  });
  const source = path.join(root, "source");
  await mkdir(path.join(source, "nested"), { recursive: true });
  const files = {
    "nested/main.js": "module.exports = 42;",
    "nested/main.js.map": "debug information",
    "nested/query_engine-windows.dll.node": "required engine",
    "nested/query_engine-windows.dll.node.tmp22956": "temporary engine",
    "LICENSE.txt": "license must remain",
    "font.bcmap": "PDF character map",
    "data.json": "{}",
    "template.tmp": "unrelated template",
  };
  for (const [name, contents] of Object.entries(files)) await writeFile(path.join(source, name), contents);
  return { root, source, files };
}

test("准备阶段过滤映射与引擎临时文件，同时保留源依赖、许可证和 PDF 字符映射", async (t) => {
  const f = await fixture(t);
  const destination = path.join(f.root, "package");
  await cp(f.source, destination, { recursive: true, filter: isReleaseFile });
  for (const [name, contents] of Object.entries(f.files)) {
    assert.equal(await readFile(path.join(f.source, name), "utf8"), contents);
    if (name.endsWith(".map") || name.endsWith(".tmp22956")) {
      await assert.rejects(stat(path.join(destination, name)), { code: "ENOENT" });
    } else assert.equal(await readFile(path.join(destination, name), "utf8"), contents);
  }
});

test("最终清理覆盖依赖子目录且可重复执行，保留正式引擎与业务文件", async (t) => {
  const f = await fixture(t);
  const result = await pruneReleaseFiles(f.source);
  assert.equal(result.files, 2);
  assert.equal(result.bytes, Buffer.byteLength(f.files["nested/main.js.map"] + f.files["nested/query_engine-windows.dll.node.tmp22956"]));
  assert.equal(await readFile(path.join(f.source, "nested/query_engine-windows.dll.node"), "utf8"), "required engine");
  assert.equal(await readFile(path.join(f.source, "LICENSE.txt"), "utf8"), "license must remain");
  assert.equal(await readFile(path.join(f.source, "font.bcmap"), "utf8"), "PDF character map");
  assert.equal(await readFile(path.join(f.source, "template.tmp"), "utf8"), "unrelated template");
  assert.deepEqual(await pruneReleaseFiles(f.source), { files: 0, bytes: 0 });
});

test("清理不沿目录链接删除外部文件", async (t) => {
  const f = await fixture(t);
  const external = path.join(f.root, "external");
  await mkdir(external);
  await writeFile(path.join(external, "keep.js.map"), "outside package");
  await symlink(external, path.join(f.source, "linked"), "junction");
  await pruneReleaseFiles(f.source);
  assert.equal(await readFile(path.join(external, "keep.js.map"), "utf8"), "outside package");
});
