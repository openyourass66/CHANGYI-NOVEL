import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
export async function verifyDesktop(baseURL: string, email: string, password: string) {
  assert.equal(process.platform, "win32", "Windows 桌面联调需要 Windows");
  const desktop = path.resolve("../desktop");
  const storage = path.join(desktop, ".verify", randomUUID()); await mkdir(storage, { recursive: true });
  let calls = 0;
  const model = createServer((request, response) => {
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.headers.cookie, undefined, "账号 Cookie 不得发送到本地模型");
    assert.equal(request.headers.authorization, "Bearer device-local-fixture-key");
    calls++;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ chapterNote: { summary: "桌面设备分析完成", excerpt: "桌面链路测试正文。" } }) } }], usage: { total_tokens: 8 } }));
  });
  await new Promise<void>(resolve => model.listen(0, "127.0.0.1", resolve)); const address = model.address(); assert(address && typeof address !== "string");
  const electron = createRequire(path.join(desktop, "package.json"))("electron") as string;
  const env: NodeJS.ProcessEnv = { ...process.env, CHANGYI_SMOKE_DATA: storage, CHANGYI_INTEGRATION_URL: baseURL, CHANGYI_INTEGRATION_EMAIL: email, CHANGYI_INTEGRATION_PASSWORD: password, CHANGYI_LOCAL_MODEL_URL: `http://127.0.0.1:${address.port}/v1` };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [".", "--smoke"], { cwd: desktop, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let output = ""; child.stdout.on("data", data => { output += String(data); }); child.stderr.on("data", data => { output += String(data); });
  const timer = setTimeout(() => child.kill(), 60_000);
  try { const exit = await new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); }); assert.equal(exit, 0, output); assert(calls > 0, "客户端必须实际调用设备模型"); console.log(output.trim()); }
  finally { clearTimeout(timer); model.closeAllConnections(); await new Promise<void>(resolve => model.close(() => resolve())); }
}
