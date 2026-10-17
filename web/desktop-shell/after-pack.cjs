const { cp, access } = require("node:fs/promises");
const path = require("node:path");
const { isReleaseFile, pruneReleaseFiles } = require("./packaging-files.cjs");

// Copy runtime dependencies explicitly: the builder's file filters omit
// node_modules from extraResources, including the standalone Next.js runtime.
module.exports = async ({ appOutDir }) => {
  const stage = path.resolve(__dirname, "../.desktop-build");
  const resources = path.join(appOutDir, "resources");
  for (const [source, target] of [
    ["standalone", "standalone"],
    ["prisma", "prisma"],
    ["prisma-cli/node_modules", "app.asar.unpacked/node_modules"],
  ]) {
    await cp(path.join(stage, source), path.join(resources, target), {
      recursive: true, dereference: true, force: true, filter: isReleaseFile,
    });
  }
  const removed = await pruneReleaseFiles(appOutDir);
  console.log(`发行包清理：移除 ${removed.files} 个映射或引擎临时文件（${(removed.bytes / 1024 / 1024).toFixed(2)} MiB）。`);
  for (const file of [
    "standalone/server.js", "standalone/node_modules/next/package.json",
    "standalone/node_modules/@prisma/client/package.json",
    "standalone/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    "app.asar.unpacked/node_modules/prisma/build/index.js",
    "app.asar.unpacked/node_modules/@prisma/engines/schema-engine-windows.exe",
    "prisma/schema.prisma",
  ]) await access(path.join(resources, file));
};
