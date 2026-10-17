import { cp, mkdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { createRequire, isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stageRoot = path.join(webRoot, ".desktop-build");
const standaloneTarget = path.join(stageRoot, "standalone");
const relativeStage = path.relative(webRoot, stageRoot);
if (!relativeStage || relativeStage.startsWith("..") || path.isAbsolute(relativeStage)) {
  throw new Error(`拒绝清理项目目录之外的路径：${stageRoot}`);
}

type Manifest = {
  name: string; version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};
async function manifest(directory: string): Promise<Manifest> {
  return JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
}

async function packageRoot(name: string, from: string) {
  const resolveFrom = createRequire(path.join(from, "package.json"));
  // Resolve through Node's search paths; package.json may not be exported.
  for (const search of resolveFrom.resolve.paths(name) ?? []) {
    const candidate = path.join(search, ...name.split("/"));
    try {
      if ((await manifest(candidate)).name === name) return realpath(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error(`缺少运行依赖 ${name}（来源 ${from}）`);
}

async function collectDependencies(from: string, output: string, roots: string[]) {
  const rootModules = path.join(output, "node_modules");
  const installed = new Map<string, string>();
  const queue: Array<{ source: string; destination: string }> = [];

  async function reserve(name: string, parentSource: string, parentDestination: string, direct = false) {
    if (isBuiltin(name)) return;
    const source = await packageRoot(name, parentSource);
    const destinationAtRoot = path.join(rootModules, ...name.split("/"));
    if (installed.get(destinationAtRoot) === source) return;
    const destination = !installed.has(destinationAtRoot) || direct
      ? destinationAtRoot
      : path.join(parentDestination, "node_modules", ...name.split("/"));
    if (installed.get(destination) === source) return;
    if (installed.has(destination)) throw new Error(`运行依赖版本冲突：${name}`);
    installed.set(destination, source);
    queue.push({ source, destination });
  }

  for (const name of roots) await reserve(name, from, output, true);
  for (let index = 0; index < queue.length; index++) {
    const { source, destination } = queue[index];
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, {
      recursive: true, dereference: true,
      filter: (file) => {
        const parts = path.relative(source, file).split(path.sep);
        return !parts.includes("node_modules") && !parts.includes(".cache");
      },
    });
    const pkg = await manifest(source);
    const optional = pkg.optionalDependencies ?? {};
    const requiredPeers = Object.keys(pkg.peerDependencies ?? {}).filter(
      (name) => !pkg.peerDependenciesMeta?.[name]?.optional,
    );
    const dependencies = new Set([...Object.keys(pkg.dependencies ?? {}), ...requiredPeers, ...Object.keys(optional)]);
    for (const name of dependencies) {
      try { await reserve(name, source, destination); }
      catch (error) {
        if (!Object.hasOwn(optional, name)) throw error;
      }
    }
  }
  return installed.size;
}

await rm(stageRoot, { recursive: true, force: true });
await mkdir(standaloneTarget, { recursive: true });
const standaloneSource = path.join(webRoot, ".next", "standalone");
for (const name of ["server.js", "package.json", ".next"]) {
  await cp(path.join(standaloneSource, name), path.join(standaloneTarget, name), { recursive: true, dereference: true });
}
await cp(path.join(webRoot, ".next", "static"), path.join(standaloneTarget, ".next", "static"), { recursive: true });
try {
  await stat(path.join(webRoot, "public"));
  await cp(path.join(webRoot, "public"), path.join(standaloneTarget, "public"), { recursive: true });
} catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

const appManifest = await manifest(webRoot);
const runtimeCount = await collectDependencies(webRoot, standaloneTarget, Object.keys(appManifest.dependencies ?? {}));
// Prisma's generated client is a runtime artifact outside @prisma/client.
const prismaClientRoot = await packageRoot("@prisma/client", webRoot);
const generatedClient = path.dirname(createRequire(path.join(prismaClientRoot, "package.json")).resolve(".prisma/client/package.json"));
await cp(generatedClient, path.join(standaloneTarget, "node_modules", ".prisma", "client"), { recursive: true, dereference: true });

const cliCount = await collectDependencies(webRoot, path.join(stageRoot, "prisma-cli"), ["prisma"]);
await mkdir(path.join(stageRoot, "prisma"), { recursive: true });
for (const name of ["schema.prisma", "migrations"]) {
  await cp(path.join(webRoot, "prisma", name), path.join(stageRoot, "prisma", name), { recursive: true });
}
console.log(`桌面运行资源已准备：Web ${runtimeCount} 个依赖包，迁移 ${cliCount} 个依赖包。`);
