import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";

test.beforeEach(async ({ page }) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "changyi-native-e2e-"));
  const process = spawn(path.resolve("src-tauri/target/debug/examples/test-workspace.exe"), [directory], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const pending: { resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
  const lines = createInterface({ input: process.stdout });
  const exports: { fileName: string; text: string }[] = [];
  await page.exposeFunction("readNativeExports", () => exports);
  lines.on("line", (line) => pending.shift()?.resolve(JSON.parse(line)));
  process.on("error", (error) => { for (const waiter of pending.splice(0)) waiter.reject(error); });
  process.on("exit", () => { for (const waiter of pending.splice(0)) waiter.reject(new Error("Native test workspace stopped")); });
  await page.exposeFunction("nativeTestInvoke", (command: string, args: { request?: unknown; fileName?: string; text?: string }) => {
    if (command === "get_storage") return { supported: true, dataDir: directory, needsSetup: false };
    if (command === "save_text") { exports.push({ fileName: args.fileName!, text: args.text! }); return true; }
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

test("settings creates and edits an encrypted model profile", async ({ page }) => {
  await page.goto("/#/settings");
  await expect(page.getByText("还没有模型档案")).toBeVisible();
  await page.getByRole("button", { name: "新增档案" }).first().click();
  await page.locator("#pf-name").fill("本地测试");
  await page.locator("#pf-provider").click();
  await page.getByRole("option", { name: /Ollama/ }).click();
  await page.locator("#pf-model").fill("qwen-test");
  await page.getByRole("button", { name: "创建档案" }).click();
  await page.getByRole("button", { name: "知道了" }).click();
  await expect(page.getByText("本地测试", { exact: true })).toBeVisible();
  await expect(page.getByText("qwen-test")).toBeVisible();
  await page.getByRole("button", { name: "本地测试 的操作" }).click();
  await page.getByRole("menuitem", { name: "编辑" }).click();
  await page.locator("#pf-name").fill("本地模型");
  await page.getByRole("button", { name: "保存修改" }).click();
  await page.getByRole("button", { name: "知道了" }).click();
  await expect(page.getByText("本地模型", { exact: true })).toBeVisible();
});

test("analysis calls a local model and shows a proposal for review", async ({ page }) => {
  let requests = 0;
  const server = createServer((_request, response) => {
    const content = requests++ === 0
      ? JSON.stringify({
        chapterNote: { summary: "主角回到故乡。", excerpt: "回到故乡" },
        events: [], characters: [], settings: [], threads: [], glossary: [],
      })
      : JSON.stringify({
        overview: "主角已归乡。", endingState: "主角抵达故乡。",
        unresolved: [], constraints: ["故乡位于北方"], choices: [], ambiguities: [],
      });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 50 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Mock model address unavailable");
    await createProject(page, "分析验收小说");
    await page.locator('input[type="file"]').setInputFiles({ name: "小说.txt", mimeType: "text/plain", buffer: Buffer.from("第一章 故乡\n他回到故乡。") });
    await page.getByRole("button", { name: "导入并解析" }).click();
    await expect(page.getByText("已解析 1 个章节", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "知道了" }).click();
    await page.evaluate(async (baseUrl) => {
      const response = await fetch("/api/model-profiles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "本地验收模型", provider: "ollama", model: "mock", baseUrl, isLocal: true }),
      });
      if (!response.ok) throw new Error(await response.text());
    }, `http://127.0.0.1:${address.port}/v1`);
    await page.getByRole("link", { name: "理解分析" }).click();
    await expect(page.getByRole("button", { name: "开始逐章抽取" })).toBeVisible();
    await page.getByRole("button", { name: "开始逐章抽取" }).click();
    await page.getByRole("button", { name: "知道了" }).click();
    await expect(page.getByText("主角回到故乡。", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/第 1 章：回到故乡/)).toBeVisible();
    await page.getByRole("button", { name: "采纳", exact: true }).click();
    await page.getByRole("button", { name: "知道了" }).click();
    await page.getByRole("link", { name: "记忆工作台" }).click();
    await expect(page.getByText("主角回到故乡。", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "理解分析" }).click();
    await page.getByRole("button", { name: /全书统合/ }).first().click();
    await page.getByRole("button", { name: "开始全书统合" }).click();
    await page.getByRole("button", { name: "知道了" }).click();
    await expect(page.getByText("主角已归乡。", { exact: true })).toBeVisible({ timeout: 15_000 });
    expect(requests).toBe(2);
  } finally {
    server.close();
  }
});

test("continuation saves a manual direction and outline", async ({ page }) => {
  await createProject(page, "方向验收小说");
  await page.getByRole("link", { name: "续写规划" }).click();
  await page.getByRole("button", { name: "自定义方向" }).first().click();
  await page.locator("#direction-name").fill("追查旧案");
  await page.locator("#direction-summary").fill("主角回到旧城，查清十年前的失踪案。");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "知道了" }).click();
  await expect(page.getByText("追查旧案", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "编辑章纲" }).click();
  await page.getByRole("button", { name: "添加一章" }).click();
  await page.getByLabel("第 1 章标题").fill("重返旧城");
  await page.getByLabel("第 1 章走向").fill("主角找到第一条线索。");
  await page.getByRole("button", { name: "保存章纲" }).click();
  await page.getByRole("button", { name: "知道了" }).click();
  await expect(page.getByText("第 1 章 · 重返旧城")).toBeVisible();
});

test("draft generation, continuity evidence, and memory extraction use the native backend", async ({ page }) => {
  const outputs = [
    { title: "城门", content: "他沿着熟悉的街道缓缓前行，旧城的石墙仍带着雨后的凉意。远处钟声响起，提醒他十年前的线索还没有结束。他停在城门前，决定先去寻找当年的目击者。" },
    { issues: [{ category: "设定", severity: "warning", description: "城门状态需要核对", draftExcerpts: ["他停在城门前"], memoryRefs: ["M1"] }] },
    { items: [{ category: "chapter-note", key: "", title: "", content: "主角寻找目击者。" }] },
  ];
  let requests = 0;
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(outputs[requests++]) } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Mock endpoint unavailable");
    await createProject(page, "草稿验收小说");
    await page.evaluate(async (baseUrl) => {
      const id = location.hash.match(/projects\/([^/?]+)/)![1];
      const post = async (path: string, body: unknown, method = "POST") => {
        const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      };
      await post(`/api/projects/${id}/memory`, { category: "character", title: "主角", key: "hero", content: "已回旧城", status: "confirmed", citations: [] });
      const { plan } = await post(`/api/projects/${id}/plans`, { direction: "追查旧案", summary: "寻找目击者", select: true });
      await post(`/api/projects/${id}/plans/${plan.id}`, { outline: [{ title: "城门", summary: "主角来到城门", beats: [], relatedThreads: [] }] }, "PATCH");
      await post("/api/model-profiles", { name: "本地验收", provider: "ollama", model: "mock", baseUrl, isLocal: true });
    }, `http://127.0.0.1:${address.port}/v1`);
    await page.getByRole("link", { name: "续写规划" }).click();
    await page.getByRole("button", { name: /^生成草稿/ }).first().click();
    await page.getByRole("button", { name: "开始生成草稿" }).click();
    await page.getByRole("button", { name: "知道了" }).click();
    await expect(page.getByRole("button", { name: "阅读 / 编辑" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "检查连续性", exact: true }).click();
    await page.getByRole("button", { name: "知道了" }).click();
    await expect(page.getByText("1 处待核对")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "提取记忆变化", exact: true }).click();
    await page.getByRole("button", { name: "知道了" }).click();
    await expect(page.getByText("有记忆提案", { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "阅读 / 编辑" }).click();
    await expect(page.getByText("城门状态需要核对", { exact: true })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "导出", exact: true }).click();
    const saved = await page.evaluate(async () => (window as unknown as {
      readNativeExports: () => Promise<{fileName:string;text:string}[]>
    }).readNativeExports());
    expect(saved[0].fileName).toBe("第1章-城门.txt");
    expect(saved[0].text).toContain("他停在城门前");
    expect(requests).toBe(3);
  } finally { server.close(); }
});
