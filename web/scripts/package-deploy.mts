import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const webRootFiles = new Set([
  ".dockerignore", ".env.example", ".env.production.example", ".gitignore", "AGENTS.md",
  "README.md", "Dockerfile", "compose.yaml", "components.json", "eslint.config.mjs",
  "next.config.ts", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json",
]);
const webFolders = new Set(["src", "public", "prisma", "prisma-postgresql", "deploy", "scripts"]);
const samples = new Set(["web/.env.example", "web/.env.production.example", "admin-console/.env.example"]);
const webFiles = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z", "--", "web"], { cwd: repo, encoding: "utf8" }).split("\0").filter(Boolean);
const contracts = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z", "--", "packages/contracts"], { cwd: repo, encoding: "utf8" }).split("\0").filter(Boolean);
const adminFiles = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z", "--", "admin-console"], { cwd: repo, encoding: "utf8" }).split("\0").filter(Boolean);
const selected = [...new Set(["README.md", ".gitattributes", ".dockerignore", ...contracts, ...adminFiles, ...webFiles.filter((file) => {
  const parts = file.split("/");
  return parts.length === 2 ? webRootFiles.has(parts[1]) : webFolders.has(parts[1]);
})])].sort();
const snapshot = path.join(repo, "web", ".verify", "deploy", `novel-vm-${randomUUID().slice(0, 8)}`);
const stage = path.join(snapshot, "source");
await mkdir(stage, { recursive: true });
const hashes: { file: string; sha256: string; bytes: number }[] = [];
for (const file of selected) {
  const parts = file.split("/");
  if (parts.some((part) => ["..", ".git", "node_modules", ".next", ".verify", "data"].includes(part))
    || /[\r\n]/.test(file) || /\.(db|sqlite|sqlite3|pem|key|p12|log)$/i.test(file)
    || (parts.some((part) => part.startsWith(".env")) && !samples.has(file))) {
    throw new Error(`拒绝打包私有或生成路径：${file}`);
  }
  const source = path.resolve(repo, file);
  const resolved = await realpath(source);
  if (path.relative(repo, resolved).startsWith("..") || (await lstat(source)).isSymbolicLink()) throw new Error(`拒绝打包外部路径或符号链接：${file}`);
  let bytes = await readFile(source);
  if (samples.has(file)) {
    for (const line of bytes.toString("utf8").split(/\r?\n/)) {
      const sensitive = line.match(/^(?:APP_ENCRYPTION_KEY|BETTER_AUTH_SECRET|POSTGRES_PASSWORD|SMTP_PASSWORD)\s*=\s*["']?([^"'\r\n]*)/);
      if (sensitive && !sensitive[1].startsWith("replace-")) throw new Error(`环境示例包含非占位密钥，已停止打包：${file}`);
    }
  }
  if (file.endsWith(".sh")) bytes = Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n"));
  const destination = path.join(stage, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: "wx" });
  hashes.push({ file, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
}
const manifestName = "DEPLOY_SNAPSHOT.json";
await writeFile(path.join(stage, manifestName), JSON.stringify({
  branch: git("branch", "--show-current"),
  baseCommit: git("rev-parse", "HEAD"),
  mainCommit: git("rev-parse", "main"),
  createdAt: new Date().toISOString(),
  note: "Source snapshot includes current uncommitted implementation. No Git history or private runtime data.",
  files: hashes,
}, null, 2), { flag: "wx" });
const archive = path.join(snapshot, "novel-vm.tar.gz");
execFileSync("tar", ["-czf", archive, "-C", stage, ...selected, manifestName], { cwd: repo, stdio: "pipe" });
const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
const expected = [...selected, manifestName].sort();
if (JSON.stringify(entries.sort()) !== JSON.stringify(expected)) throw new Error("归档条目与白名单不一致，部署包不可使用。");
const sha256 = createHash("sha256").update(await readFile(archive)).digest("hex");
await writeFile(`${archive}.sha256`, `${sha256}  novel-vm.tar.gz\n`, { flag: "wx" });
console.log(JSON.stringify({ archive, checksum: `${archive}.sha256`, sha256, sourceFiles: selected.length, bytes: (await lstat(archive)).size }, null, 2));
