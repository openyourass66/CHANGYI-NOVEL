// 先运行 pnpm build，再执行 node --test tests/continuation.test.mjs。
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, message) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(100);
  }
  throw Error(message);
}
async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

test("续写方向与生成链路（隔离数据库和本地模型接口）", { timeout: 120000 }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "changyi-continuation-"));
  const databaseUrl = `file:${path.join(root, "test.db").replaceAll("\\", "/")}`;
  const env = { ...process.env, DATABASE_URL: databaseUrl, NOVEL_DATA_DIR: root,
    APP_ENCRYPTION_KEY: randomBytes(32).toString("hex"), NEXT_TELEMETRY_DISABLED: "1" };
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  let child;
  let logs = "";
  const requests = [];
  let conflict = false;
  const mock = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    requests.push(input);
    const prompt = input.messages.at(-1).content;
    const output = prompt.includes("【本章章纲")
      ? { title: "循线", content: "主角收起卷宗，循着旧案留下的线索走向渡口。他决定先核对账册，再向同行者解释自己的发现。这一次他没有轻信传言，而是静静等待证人到来。" }
      : prompt.includes("提出 3 个")
        ? { candidates: [{ direction: "模型候选", summary: "沿旧案调查真相。", relatedThreads: ["旧案"] }] }
        : conflict
          ? { chapters: [], conflicts: ["要求师父在场，但故事记忆记载师父已经去世。"] }
          : { chapters: [{ title: "循线", summary: "主角调查旧案。", beats: ["核对账册"], relatedThreads: ["旧案"] }], conflicts: [] };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }));
  });
  try {
    const sqlite = new DatabaseSync(path.join(root, "test.db"));
    try {
      const migrations = await readdir("prisma/migrations", { withFileTypes: true });
      for (const entry of migrations.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
        sqlite.exec(await readFile(path.join("prisma/migrations", entry.name, "migration.sql"), "utf8"));
      }
    } finally { sqlite.close(); }
    const mockPort = await listen(mock);
    const portProbe = createServer();
    const port = await listen(portProbe);
    await new Promise((resolve) => portProbe.close(resolve));
    child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)],
      { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => { logs += chunk; });
    child.stderr.on("data", (chunk) => { logs += chunk; });
    const origin = `http://127.0.0.1:${port}`;
    const api = async (route, method = "GET", body) => {
      const response = await fetch(origin + route, { method, headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, ...await response.json() };
    };
    await waitFor(async () => {
      if (child.exitCode !== null) throw Error(logs);
      return fetch(origin + "/api/projects").then((r) => r.ok).catch(() => false);
    }, "测试服务未启动：" + logs);
    const projectId = (await api("/api/projects", "POST", { name: "续写验证" })).project.id;
    const otherId = (await api("/api/projects", "POST", { name: "另一个项目" })).project.id;
    const plans = `/api/projects/${projectId}/plans`;
    let plan;
    let profileId;
    const summary = "主角追查旧案，先核对账册。\n不要安排感情支线；保留师门秘密到下一阶段揭晓。";
    const runTask = async (taskType, planId) => {
      const start = await api(`/api/projects/${projectId}/analysis`, "POST", {
        taskType, profileId, payload: planId ? { planId, outlineCount: 3 } : {},
      });
      assert.equal(start.status, 201, JSON.stringify(start));
      return waitFor(async () => {
        const { run } = await api(`/api/analysis/${start.runId}`);
        return ["done", "failed"].includes(run?.status) ? run : null;
      }, "生成任务未完成");
    };
    await t.test("没有模型或记忆也可保存；名称自动提取且刷新后保留全文", async () => {
      const result = await api(plans, "POST", { summary });
      assert.equal(result.status, 201);
      plan = result.plan;
      assert.equal(plan.direction, summary.split("\n")[0]);
      assert.equal(plan.summary, summary);
      assert.equal(plan.status, "draft");
      assert.deepEqual(plan.outline, []);
      assert.equal((await api(plans)).plans[0].summary, summary);
      assert.equal(requests.length, 0);
    });
    await t.test("拒绝空内容、超长及类型错误；限制项目归属", async () => {
      for (const input of [{ summary: "  " }, { summary: "字".repeat(10001) }, { summary: 7 }, { summary, select: "yes" }]) {
        assert.equal((await api(plans, "POST", input)).status, 422);
      }
      assert.equal((await api(plans, "POST", { summary, sourcePlanId: "missing" })).status, 404);
      const foreign = `/api/projects/${otherId}/plans/${plan.id}`;
      for (const method of ["GET", "PATCH", "DELETE"]) {
        assert.equal((await api(foreign, method, method === "PATCH" ? { direction: "错误项目" } : undefined)).status, 404);
      }
      assert.equal((await api(`/api/projects/${otherId}/plans`, "POST", { summary, sourcePlanId: plan.id })).status, 404);
    });
    await t.test("编辑与选定一次保存，保留版本检查及单一当前方向", async () => {
      await api(plans, "POST", { direction: "先前方向", summary: "旧构思", select: true });
      const updated = await api(`${plans}/${plan.id}`, "PATCH", { direction: "追查旧案", summary,
        expectedVersion: plan.version, select: true });
      assert.equal(updated.status, 200);
      assert.equal(updated.plan.status, "active");
      assert.equal((await api(plans)).plans.filter((p) => p.status === "active").length, 1);
      assert.equal((await api(`${plans}/${plan.id}`, "PATCH", { direction: "过时修改", expectedVersion: plan.version })).status, 409);
      plan = updated.plan;
      assert.equal(requests.length, 0);
    });
    await t.test("生成章纲仍需记忆；章纲与正文请求都含完整作者要求", async () => {
      const profile = await api("/api/model-profiles", "POST", { name: "本地验证", provider: "lmstudio",
        model: "test", baseUrl: `http://127.0.0.1:${mockPort}/v1` });
      assert.equal(profile.status, 201);
      profileId = profile.profile.id;
      const blocked = await api(`/api/projects/${projectId}/analysis`, "POST", { taskType: "outline", profileId, payload: { planId: plan.id } });
      assert.equal(blocked.status, 400);
      assert.match(blocked.error, /记忆/);
      await db.memoryEntry.create({ data: { projectId, category: "story-bible", content: "主角正在追查旧案，师父已去世。", status: "confirmed" } });
      for (const taskType of ["outline", "draft"]) {
        const run = await runTask(taskType, plan.id);
        assert.equal(run.status, "done", run.error);
        assert.ok(requests.at(-1).messages.some((m) => m.content.includes(summary)));
      }
      assert.equal(await db.draftChapter.count({ where: { planId: plan.id } }), 1);
    });
    await t.test("已有成果的方向禁止改写；另存不携带旧章纲草稿", async () => {
      const before = (await api(`${plans}/${plan.id}`)).plan;
      const result = await api(`${plans}/${plan.id}`, "PATCH", { direction: "新走向", summary: "另一条路线" });
      assert.equal(result.status, 409);
      const copy = await api(plans, "POST", { direction: "新走向", summary: "另一条路线", sourcePlanId: plan.id, select: true });
      assert.equal(copy.status, 201);
      assert.notEqual(copy.plan.id, plan.id);
      assert.deepEqual(copy.plan.outline, []);
      assert.equal(copy.plan.draftCount, 0);
      const after = (await api(`${plans}/${plan.id}`)).plan;
      assert.deepEqual(after.outline, before.outline);
      assert.equal(after.summary, before.summary);
      assert.equal(after.draftCount, 1);
      const outlineOnly = await db.continuationPlan.create({ data: { projectId, direction: "只有章纲", outlineJson: JSON.stringify(before.outline) } });
      assert.equal((await api(`${plans}/${outlineOnly.id}`, "PATCH", { direction: "覆盖章纲方向" })).status, 409);
    });
    await t.test("AI 候选也能编辑；明确冲突停止写入并保留原章纲", async () => {
      assert.equal((await runTask("direction")).status, "done");
      const generated = (await api(plans)).plans.find((p) => p.direction === "模型候选");
      assert.ok(generated);
      assert.equal((await api(`${plans}/${generated.id}`, "PATCH", { summary: "由作者修订的方向" })).status, 200);
      const oldOutline = JSON.stringify([{ index: 1, title: "旧章纲", summary: "已保存", beats: [], relatedThreads: [] }]);
      await db.continuationPlan.update({ where: { id: generated.id }, data: { outlineJson: oldOutline } });
      conflict = true;
      const run = await runTask("outline", generated.id);
      assert.equal(run.status, "failed");
      assert.match(run.error, /师父已经去世/);
      assert.match(run.error, /尚未写入章纲/);
      assert.equal((await db.continuationPlan.findUnique({ where: { id: generated.id } })).outlineJson, oldOutline);
    });
  } finally {
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    mock.closeAllConnections();
    if (mock.listening) await new Promise((resolve) => mock.close(resolve));
    await db.$disconnect();
    if (path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith("changyi-continuation-")) {
      await rm(root, { recursive: true, force: true });
    }
  }
});
