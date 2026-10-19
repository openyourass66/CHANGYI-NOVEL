import { readFile, writeFile, readdir, mkdir, copyFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

export function createManifest({ version, notes, fileName, signature, date = new Date().toISOString() }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("正式发布版本必须使用 x.y.z 格式。");
  if (!fileName.endsWith(".exe") || basename(fileName) !== fileName) throw new Error("更新文件必须是 NSIS exe 安装包。");
  if (!signature.trim()) throw new Error("缺少安装包签名。");
  return {
    version, notes, pub_date: date,
    platforms: { "windows-x86_64": {
      url: `https://github.com/openyourass66/CHANGYI-NOVEL/releases/download/v${version}/${encodeURIComponent(fileName)}`,
      signature: signature.trim(),
    } },
  };
}

export async function generateManifest(notesFile) {
  if (!notesFile) throw new Error("请提供更新说明文件：pnpm release:manifest <说明文件路径>");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const config = JSON.parse(await readFile(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const cargo = await readFile(resolve(root, "src-tauri/Cargo.toml"), "utf8");
  const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (config.version !== pkg.version || config.version !== cargoVersion) throw new Error("package.json、Cargo.toml、tauri.conf.json 版本不一致。");
  const bundle = resolve(root, "src-tauri/target/release/bundle/nsis");
  const installers = (await readdir(bundle)).filter((name) => name.endsWith(`_${config.version}_x64-setup.exe`));
  if (installers.length !== 1) throw new Error("必须找到且仅找到当前版本的 x64 NSIS 安装包。");
  const sourceName = installers[0];
  const fileName = `Changyi_${config.version}_x64-setup.exe`;
  const signature = await readFile(resolve(bundle, `${sourceName}.sig`), "utf8");
  const notes = (await readFile(resolve(notesFile), "utf8")).trim();
  if (!notes) throw new Error("更新说明不能为空。");
  const manifest = createManifest({ version: config.version, notes, fileName, signature });
  const output = resolve(root, ".release", config.version);
  await mkdir(output, { recursive: true });
  await copyFile(resolve(bundle, sourceName), resolve(output, fileName));
  await copyFile(resolve(bundle, `${sourceName}.sig`), resolve(output, `${fileName}.sig`));
  await writeFile(resolve(output, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`更新清单：${resolve(output, "latest.json")}\n请同时上传：${resolve(output, fileName)}\n及对应 .sig 文件。`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateManifest(process.argv[2]).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
