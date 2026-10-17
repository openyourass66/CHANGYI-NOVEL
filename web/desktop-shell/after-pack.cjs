const { cp, access } = require("node:fs/promises");
const path = require("node:path");

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
      recursive: true, dereference: true, force: true,
    });
  }
  for (const file of [
    "standalone/server.js", "standalone/node_modules/next/package.json",
    "standalone/node_modules/@prisma/client/package.json",
    "app.asar.unpacked/node_modules/prisma/build/index.js",
    "app.asar.unpacked/node_modules/@prisma/engines/schema-engine-windows.exe",
    "prisma/schema.prisma",
  ]) await access(path.join(resources, file));
};
