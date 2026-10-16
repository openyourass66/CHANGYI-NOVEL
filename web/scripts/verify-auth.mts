import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { cp, mkdir, readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { startRedisFixture } from "./lib/redis-fixture.mts";

const workspace = path.resolve(".verify/auth", randomUUID());
await mkdir(workspace, { recursive: true });
const postgres = process.env.VERIFY_DATABASE_PROVIDER === "postgresql";
const postgresURL = process.env.VERIFY_DATABASE_URL;
if (postgres) {
  assert(postgresURL && /^verify_[a-f0-9]{32}$/.test(new URL(postgresURL).searchParams.get("schema") ?? ""), "PostgreSQL 验证只能使用专用隔离 schema");
}
const sqlitePath = path.join(workspace, "auth.db");
if (!postgres) new DatabaseSync(sqlitePath).close();
const listener = createServer();
await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
const address = listener.address();
assert(address && typeof address === "object");
const port = address.port;
await new Promise<void>((resolve) => listener.close(() => resolve()));
const baseURL = `http://127.0.0.1:${port}`;
const redisFixture = process.env.VERIFY_REDIS_URL ? null : await startRedisFixture();
Object.assign(process.env, {
  REDIS_URL: process.env.VERIFY_REDIS_URL ?? redisFixture!.url,
  DATABASE_URL: postgres ? postgresURL! : `file:${sqlitePath.replaceAll("\\", "/")}`,
  DATABASE_PROVIDER: postgres ? "postgresql" : "sqlite",
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  BETTER_AUTH_URL: baseURL,
  AUTH_REDIS_PREFIX: `verify:${randomUUID()}`,
  APP_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  NOVEL_DATA_DIR: path.join(workspace, "data"),
  ALLOW_SERVER_LOCAL_MODELS: "false",
});
await mkdir(process.env.NOVEL_DATA_DIR!, { recursive: true });
const migrate = (schema: string) => {
  try {
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", schema], { env: process.env, stdio: "pipe" });
  } catch {
    throw new Error("隔离测试数据库迁移失败，请检查连接、schema 与引擎兼容性。");
  }
};
if (postgres) {
  assert(process.env.VERIFY_PRISMA_SCHEMA, "PostgreSQL 验证需要限定 search_path 的隔离迁移副本");
  migrate(process.env.VERIFY_PRISMA_SCHEMA);
} else {
  // 先建立旧版 SQLite，再验证升级不会删除或自动认领旧项目。
  const oldSchema = path.join(workspace, "legacy-prisma");
  await cp("prisma", oldSchema, { recursive: true, filter: (file) => !file.includes("20261015100000_auth_ownership") && !file.includes("20261015120000_auth_redis_otp") });
  migrate(path.join(oldSchema, "schema.prisma"));
  const legacy = new DatabaseSync(sqlitePath);
  legacy.prepare('INSERT INTO "NovelProject" (id, name, updatedAt) VALUES (?, ?, ?)').run("legacy-project", "legacy-private", Date.now());
  legacy.close();
  migrate("prisma/schema.prisma");
}
const prisma = new PrismaClient({ log: [] });
const delivered: { email: string; text: string }[] = [];
const authValues = new Map<string, string>();
const testSecondaryStorage = {
  get: async (key: string) => authValues.get(key) ?? null,
  getAndDelete: async (key: string) => { const value = authValues.get(key) ?? null; authValues.delete(key); return value; },
  set: async (key: string, value: string) => { authValues.set(key, value); },
  delete: async (key: string) => { authValues.delete(key); },
  increment: async (key: string) => { const value = Number(authValues.get(key) ?? "0") + 1; authValues.set(key, String(value)); return value; },
};
const { createAuth } = await import("../src/lib/auth");
const auth = createAuth(async (email, _subject, text) => { delivered.push({ email, text }); }, testSecondaryStorage);
const password = "private-test-12345";
const authRequest = (route: string, body?: unknown, cookie?: string) => auth.handler(new Request(`${baseURL}/api/auth${route}`, {
  method: body ? "POST" : "GET",
  headers: { "Content-Type": "application/json", Origin: baseURL, "x-changyi-auth-ip": "127.0.0.1", ...(cookie ? { Cookie: cookie } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}));
let server: ReturnType<typeof spawn> | undefined;
try {
  const emails = ["owner-a@example.test", "owner-b@example.test"];
  const cookies: string[] = [];
  for (const email of emails) {
    assert.equal((await authRequest("/sign-up/email", { email, name: "测试账号", password })).status, 200);
    const before = await authRequest("/sign-in/email", { email, password });
    assert.equal(before.status, 403, "未验证邮箱必须禁止登录");
    const mail = delivered.find((item) => item.email === email)!;
    assert(mail, "注册必须发送邮箱验证码");
    const otp = mail.text.match(/验证码是：(\d{6})/)?.[1];
    assert(otp, "验证码邮件必须包含 6 位验证码");
    const verified = await authRequest("/email-otp/verify-email", { email, otp });
    assert.equal(verified.status, 200);
    const login = await authRequest("/sign-in/email", { email, password });
    assert.equal(login.status, 200);
    cookies.push(login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; "));
  }
  const users = await prisma.user.findMany({ orderBy: { email: "asc" } });
  assert.equal(users.length, 2);
  if (!postgres) assert.equal((await prisma.novelProject.findUniqueOrThrow({ where: { id: "legacy-project" } })).ownerId, null);
  const accounts = await prisma.account.findMany();
  assert(accounts.every((account) => account.password && !account.password.includes(password)), "数据库只能保存密码哈希");

  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], { env: { ...process.env, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
  let serverOutput = "";
  server.stdout?.on("data", (data) => { serverOutput += String(data); });
  server.stderr?.on("data", (data) => { serverOutput += String(data); });
  const request = (route: string, cookie?: string, method = "GET", body?: unknown, origin = baseURL) => fetch(`${baseURL}${route}`, {
    method, redirect: "manual", headers: { Origin: origin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error(`测试服务启动失败：${serverOutput.slice(-1500)}`);
    try { if ((await request("/api/health")).status === 200) { ready = true; break; } } catch { /* 等待启动 */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(ready, "测试服务必须就绪");
  assert.equal((await request("/api/projects")).status, 401);
  const page = await request("/");
  assert.equal(page.status, 307);
  assert(new URL(page.headers.get("location")!, baseURL).pathname === "/login");
  const beforeClaim = await (await request("/api/projects", cookies[0])).json();
  assert.equal(beforeClaim.projects.length, 0, "未认领旧项目不能泄露给注册账号");
  if (!postgres) {
    execFileSync(process.execPath, ["--import", "tsx", "scripts/claim-legacy.mts", "--email", emails[0], "--apply"], { env: process.env, stdio: "pipe" });
    assert.equal((await prisma.novelProject.findUniqueOrThrow({ where: { id: "legacy-project" } })).ownerId, users[0].id);
  }
  const created = await request("/api/projects", cookies[0], "POST", { name: "owner-a-private" });
  assert.equal(created.status, 201);
  const projectId: string = (await created.json()).project.id;
  assert.equal((await request("/api/projects", cookies[0], "POST", { name: "csrf" }, "https://untrusted.example")).status, 403);
  const listB = await (await request("/api/projects", cookies[1])).json();
  assert.equal(listB.projects.length, 0);
  const source = await prisma.sourceDocument.create({ data: { projectId, fileName: "test.txt", format: "txt", storedPath: `projects/${projectId}/sources/test.txt`, contentHash: "fixture", byteSize: 1 } });
  const chapter = await prisma.chapter.create({ data: { projectId, sourceDocumentId: source.id, rawTitle: "chapter", normalizedIndex: 1, content: "private text", startOffset: 0, endOffset: 12, sortOrder: 0 } });
  const memory = await prisma.memoryEntry.create({ data: { projectId, category: "story-bible", content: "private memory" } });
  const knowledge = await prisma.characterKnowledge.create({ data: { projectId, characterName: "test", infoItem: "private", relation: "known" } });
  const proposal = await prisma.memoryProposal.create({ data: { projectId, kind: "add", category: "story-bible", content: "private proposal", status: "confirmed" } });
  const run = await prisma.analysisRun.create({ data: { projectId, taskType: "chapter-extract" } });
  const plan = await prisma.continuationPlan.create({ data: { projectId, direction: "private plan" } });
  for (const [route, method] of [
    [`/api/projects/${projectId}`, "GET"], [`/api/projects/${projectId}/export`, "GET"],
    [`/api/projects/${projectId}/import`, "POST"], [`/api/projects/${projectId}/memory/export`, "GET"],
    [`/api/chapters/${chapter.id}`, "GET"], [`/api/chapters/${chapter.id}/split`, "POST"],
    [`/api/memory/${memory.id}`, "PATCH"], [`/api/memory/${memory.id}/history`, "GET"],
    [`/api/knowledge/${knowledge.id}`, "DELETE"], [`/api/proposals/${proposal.id}/accept`, "POST"],
    [`/api/analysis/${run.id}`, "GET"], [`/api/analysis/${run.id}/resume`, "POST"],
    [`/api/analysis/${run.id}/cancel`, "POST"], [`/api/projects/${projectId}/plans/${plan.id}`, "GET"],
  ]) assert.equal((await request(route, cookies[1], method, method === "GET" ? undefined : {})).status, 404, route);
  assert.equal((await request(`/projects/${projectId}`, cookies[1])).status, 404);
  assert.equal((await request("/api/v1/projects")).status, 401);
  assert.equal((await request("/api/v1/projects", cookies[0])).status, 200);
  assert.equal((await request(`/api/v1/projects/${projectId}`, cookies[1])).status, 404);
  for (const view of ["chapters", "analysis", "memory", "continuation"]) {
    const route = `/api/v1/workspaces/${projectId}?view=${view}`;
    assert.equal((await request(route, cookies[1])).status, 404, route);
    const response = await request(route, cookies[0]);
    assert.equal(response.status, 200, route);
    const body = await response.json();
    assert.equal(body.workspace.view, view);
    assert(!JSON.stringify(body).includes("storedPath"), "工作台不返回服务端文件路径");
  }
  assert.equal((await request("/api/v1/settings", cookies[0])).status, 200);
  const v1login = await request("/api/v1/auth/sign-in/email", undefined, "POST", { email: emails[0], password });
  assert.equal(v1login.status, 200, "版本化认证必须可登录");
  const profileA = await (await request("/api/model-profiles", cookies[0], "POST", { name: "A", provider: "openai-compatible", model: "test", baseUrl: "https://example.invalid/v1", apiKey: "test-only-not-a-real-api-key" })).json();
  assert(profileA.profile?.id, JSON.stringify(profileA));
  const profileId = profileA.profile.id;
  assert(!JSON.stringify(profileA).includes("test-only-not-a-real-api-key"));
  assert.equal((await request(`/api/model-profiles/${profileId}`, cookies[1], "PATCH", { name: "unauthorized" })).status, 404);
  assert.equal((await request(`/api/model-profiles/${profileId}/test`, cookies[1], "POST", {})).status, 404);
  const foreignProfile = await prisma.modelProfile.create({ data: { userId: users[1].id, name: "B", provider: "ollama", model: "test", isLocal: true, executionLocation: "device" } });
  assert.equal((await request(`/api/projects/${projectId}/analysis/preview`, cookies[0], "POST", { profileId: foreignProfile.id })).status, 400, "禁止借用其他账号的模型密钥");
  const localProfile = await prisma.modelProfile.create({ data: { userId: users[0].id, name: "local", provider: "ollama", model: "test", isLocal: true, executionLocation: "device" } });
  const localAttempt = await request(`/api/model-profiles/${localProfile.id}/test`, cookies[0], "POST", {});
  assert.equal(localAttempt.status, 400, "部署服务必须拒绝设备本地模型执行");
  assert.equal((await request(`/api/projects/${projectId}/export`, cookies[0])).status, 200);

  assert.equal((await authRequest("/request-password-reset", { email: emails[0], redirectTo: `${baseURL}/login?mode=reset` })).status, 400, "邮件链接找回密码必须停用");
  assert.equal((await authRequest("/email-otp/request-password-reset", { email: emails[0] })).status, 200);
  const resetMail = delivered.filter((mail) => mail.email === emails[0]).at(-1)!;
  const resetOtp = resetMail.text.match(/验证码是：(\d{6})/)?.[1];
  assert(resetOtp, "找回密码邮件必须使用 6 位验证码");
  assert([...authValues.values()].every((value) => !value.includes(resetOtp)), "重置验证码不得明文保存");
  assert.equal((await authRequest("/email-otp/reset-password", { email: emails[0], otp: resetOtp, password: "changed-test-456" })).status, 200);
  assert.equal((await request("/api/projects", cookies[0])).status, 401, "密码重置必须撤销原会话");
  assert.equal((await authRequest("/email-otp/reset-password", { email: emails[0], otp: resetOtp, password })).status, 400, "重置验证码必须单次有效");
  assert.equal((await request("/api/auth/sign-out", cookies[1], "POST", {})).status, 200);
  assert.equal((await request("/api/projects", cookies[1])).status, 401, "退出必须撤销会话");
  let limited = false;
  for (let i = 0; i < 7; i++) {
    const response = await fetch(`${baseURL}/api/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: baseURL, "x-forwarded-for": `203.0.113.${i}`, "x-changyi-auth-ip": `203.0.113.${i}` }, body: JSON.stringify({ email: emails[0], password: "wrong" }) });
    if (response.status === 429) { limited = true; break; }
  }
  assert(limited, "伪造来源 IP 不能绕过登录限流");
  for (const file of await readdir("src/app/api", { recursive: true })) {
    if (!file.endsWith("route.ts") || file.startsWith(`auth${path.sep}`) || file.startsWith(`v1${path.sep}auth${path.sep}`) || file.startsWith(`health${path.sep}`)) continue;
    assert((await readFile(path.join("src/app/api", file), "utf8")).includes("withAccount("), `${file} 必须声明归属校验`);
  }
  console.log(`PASS (${postgres ? "PostgreSQL" : "SQLite + legacy migration"}): email verification, password hashing/reset, revoked sessions, API/page isolation, model ownership, local execution boundary, CSRF and persistent auth rate limits.`);
} finally {
  if (server && server.exitCode === null) {
    const stopped = new Promise((resolve) => server!.once("exit", resolve));
    server.kill();
    await stopped;
  }
  await prisma.$disconnect();
  await redisFixture?.stop();
  // 保留隔离数据库供失败诊断；不访问 web/data 或真实账号数据。
}
