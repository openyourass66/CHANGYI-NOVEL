import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { generateManifest } from "./release-manifest.mjs";

const notesFile = process.argv[2];
if (!notesFile || !process.env.TAURI_SIGNING_PRIVATE_KEY) {
  console.error("请设置 TAURI_SIGNING_PRIVATE_KEY，并执行 pnpm release:build <更新说明文件路径>。");
  process.exit(1);
}
// 使用当前 pnpm 的 JS 入口，避免 Windows shell 对参数进行二次解释。
const result = spawnSync(process.execPath, [process.env.npm_execpath, "desktop:dist"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "inherit", env: process.env,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
await generateManifest(notesFile);
