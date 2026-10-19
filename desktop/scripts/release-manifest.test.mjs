import { test } from "node:test";
import assert from "node:assert/strict";
import { createManifest } from "./release-manifest.mjs";

test("更新清单使用当前版本下载地址并保留完整签名和更新说明", () => {
  const manifest = createManifest({ version: "0.2.13", notes: "修复\n更新", fileName: "长亿_0.2.13_x64-setup.exe", signature: " signed\nbytes\n", date: "2026-10-19T00:00:00Z" });
  assert.equal(manifest.platforms["windows-x86_64"].url, "https://github.com/openyourass66/CHANGYI-NOVEL/releases/download/v0.2.13/%E9%95%BF%E4%BA%BF_0.2.13_x64-setup.exe");
  assert.equal(manifest.platforms["windows-x86_64"].signature, "signed\nbytes");
  assert.equal(manifest.notes, "修复\n更新");
});

test("拒绝缺少签名、无效版本或非安装包文件的清单", () => {
  const valid = { version: "0.2.13", notes: "更新", fileName: "app.exe", signature: "signature" };
  for (const bad of [{ signature: " " }, { version: "v0.2.13" }, { fileName: "app.zip" }, { fileName: "../app.exe" }]) {
    assert.throws(() => createManifest({ ...valid, ...bad }));
  }
});
