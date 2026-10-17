import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test.beforeEach(async ({ page }) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "changyi-native-e2e-"));
  const process = spawn(path.resolve("src-tauri/target/debug/examples/test-workspace.exe"), [directory], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const pending: { resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
  const lines = createInterface({ input: process.stdout });
  lines.on("line", (line) => pending.shift()?.resolve(JSON.parse(line)));
  process.on("error", (error) => { for (const waiter of pending.splice(0)) waiter.reject(error); });
  process.on("exit", () => { for (const waiter of pending.splice(0)) waiter.reject(new Error("Native test workspace stopped")); });
  await page.exposeFunction("nativeTestInvoke", (command: string, args: { request?: unknown }) => {
    if (command === "get_storage") return { supported: true, dataDir: directory, needsSetup: false };
    if (command !== "api_request") return null;
    return new Promise((resolve, reject) => {
      pending.push({ resolve, reject });
      process.stdin.write(JSON.stringify(args.request) + "\n");
    });
  });
  await page.addInitScript(() => {
    const target = window as unknown as { isTauri: boolean; __TAURI_INTERNALS__: unknown; nativeTestInvoke: unknown };
    target.isTauri = true;
    target.__TAURI_INTERNALS__ = { invoke: target.nativeTestInvoke, metadata: { currentWindow: { label: "main" } } };
  });
  page.on("close", () => {
    lines.close();
    process.stdin.end();
    process.once("exit", () => { void rm(directory, { recursive: true, force: true }); });
  });
});

async function createProject(page: import("@playwright/test").Page, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "新建项目", exact: true }).first().click();
  await page.getByLabel("项目名称").fill(name);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.getByRole("button", { name: "知道了", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

test("project, document Worker, native database, chapter correction, and navigation", async ({ page }) => {
  await createProject(page, "迁移验收小说");
  await page.locator('input[type="file"]').setInputFiles({ name: "小说.txt", mimeType: "text/plain", buffer: Buffer.from("第一章 开始\n甲😀乙丙\n\n第二章 回来\n他回到了故乡。") });
  await page.getByRole("button", { name: "导入并解析" }).click();
  await expect(page.getByText("已解析 2 个章节", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "知道了", exact: true }).click();
  await expect(page.getByLabel("第一章 开始 正文（只读）")).toContainText("甲😀乙丙");
  await page.getByRole("button", { name: "重命名章节" }).click();
  await page.getByRole("dialog").locator("input").fill("第一章 新标题");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "知道了", exact: true }).click();
  await expect(page.getByLabel("第一章 新标题 正文（只读）")).toContainText("甲😀乙丙");
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page.getByRole("link", { name: "返回项目", exact: true }).click();
  await expect(page.getByLabel("第一章 新标题 正文（只读）")).toContainText("甲😀乙丙");
  await page.screenshot({ path: ".verify/chapters.png", fullPage: true });
});

function pdfFixture() {
  const stream = "BT /F1 12 Tf 72 720 Td (Chapter one. This is a PDF import compatibility test with enough text.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let content = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(content)); content += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(content);
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  content += offsets.slice(1).map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`).join("");
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
}

test("PDF.js loads its Worker and font assets in the production frontend", async ({ page }) => {
  await createProject(page, "PDF验收小说");
  await page.locator('input[type="file"]').setInputFiles({ name: "sample.pdf", mimeType: "application/pdf", buffer: pdfFixture() });
  await page.getByRole("button", { name: "导入并解析" }).click();
  await expect(page.getByText("已解析 1 个章节", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "知道了", exact: true }).click();
  await expect(page.locator(".reading-surface")).toContainText("PDF import compatibility test");
});

test("memory workbench saves revisions, knowledge, and imported notes", async ({ page }) => {
  await createProject(page, "记忆验收小说");
  await page.getByRole("link", { name: "记忆工作台" }).click();
  await expect(page.getByRole("heading", { name: "记忆验收小说" })).toBeVisible();
  await page.getByRole("button", { name: "新建条目" }).first().click();
  await page.locator("#mem-title").fill("旧城");
  await page.locator("#mem-key").fill("city");
  await page.locator("#mem-content").fill("城门朝东");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.getByRole("button", { name: "知道了" }).click();
  await expect(page.getByText("城门朝东")).toBeVisible();
  await page.getByRole("button", { name: /旧城.*城门朝东/ }).click();
  await page.locator("#mem-content").fill("城门朝西");
  await page.getByRole("button", { name: "保存新版本" }).click();
  await page.getByRole("button", { name: "知道了" }).click();
  await page.getByRole("button", { name: /旧城.*城门朝西/ }).click();
  await page.getByRole("button", { name: "查看历史" }).click();
  await expect(page.getByText("城门朝东")).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("tab", { name: /人物认知/ }).click();
  await page.getByLabel("人物", { exact: true }).fill("林舟");
  await page.getByLabel("信息条目").fill("知道旧城入口");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByRole("button", { name: "知道了" }).click();
  await expect(page.getByText("知道旧城入口")).toBeVisible();
  await page.getByRole("button", { name: "导入记忆文档" }).click();
  await page.getByRole("dialog").locator('input[type="file"]').setInputFiles({ name: "设定集.md", mimeType: "text/markdown", buffer: Buffer.from("# 设定集\n## 禁忌\n- 入夜不得出门\n") });
  await page.getByRole("button", { name: "导入 1 个文件" }).click();
  await page.getByRole("button", { name: "知道了" }).click();
  await expect(page.getByText(/导入 1 条 · 跳过 0 条/)).toBeVisible();
  await page.getByRole("button", { name: "完成" }).click();
  await page.getByRole("tab", { name: /记忆条目/ }).click();
  await expect(page.getByRole("button", { name: /入夜不得出门/ })).toBeVisible();
});
