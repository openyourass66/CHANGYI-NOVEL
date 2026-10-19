import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = { mode: "update", downloadFails: false, taskRunning: true, installs: 0, checks: 0, prepared: false };
    Object.assign(window, { isTauri: true, updaterTest: state, __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: () => 1,
      unregisterCallback: () => {},
      invoke: async (command: string, args: any = {}) => {
        if (command === "plugin:app|version") return "0.2.12";
        if (command === "plugin:updater|check") {
          state.checks++;
          if (state.mode === "offline") throw new Error("网络不可用");
          return state.mode === "latest" ? null : { rid: 1, currentVersion: "0.2.12", version: "0.2.13", body: "改善小说写作体验", rawJson: {} };
        }
        if (command === "plugin:updater|download") {
          args.onEvent.onmessage({ event: "Started", data: { contentLength: 100 } });
          args.onEvent.onmessage({ event: "Progress", data: { chunkLength: 50 } });
          if (state.downloadFails) throw new Error("签名无效");
          args.onEvent.onmessage({ event: "Finished" });
          return 2;
        }
        if (command === "prepare_update") {
          if (state.taskRunning) throw new Error("工作区仍有任务未结束，请先完成或取消任务。");
          state.prepared = true;
        }
        if (command === "cancel_update") state.prepared = false;
        if (command === "plugin:updater|install") {
          if (!state.prepared) throw new Error("未检查任务");
          state.installs++;
        }
        if (command === "get_storage") return { supported: true, dataDir: "D:/test" };
        if (command === "api_request") {
          const path = args.request.path;
          if (path === "/api/model-profiles") return { status: 200, body: { profiles: [], encryptionReady: true } };
          if (path === "/api/workflows") return { status: 200, body: { workflows: [] } };
          if (path === "/api/settings/automation") return { status: 200, body: { autoAccept: false, autoSynthesis: false } };
          if (path.startsWith("/api/token-usage")) return { status: 500, body: { error: "测试未提供用量" } };
          return { status: 200, body: { projects: [] } };
        }
        return null;
      },
    } });
  });
});

test("检查、下载失败重试、稍后安装及任务保护", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("发现新版本 0.2.13");
  await page.evaluate(() => { (window as any).updaterTest.downloadFails = true; });
  await dialog.getByRole("button", { name: "下载更新", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("签名校验失败");
  await page.evaluate(() => { (window as any).updaterTest.downloadFails = false; });
  await dialog.getByRole("button", { name: "下载更新", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "安装并退出", exact: true })).toBeDisabled();
  await page.screenshot({ path: ".verify/updater-ready.png" });
  await dialog.getByRole("button", { name: "稍后", exact: true }).click();
  await page.getByRole("button", { name: "查看更新", exact: true }).click();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "安装并退出", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("任务未结束");
  expect(await page.evaluate(() => (window as any).updaterTest.installs)).toBe(0);
  await page.evaluate(() => { (window as any).updaterTest.taskRunning = false; });
  await dialog.getByRole("button", { name: "安装并退出", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).updaterTest.installs)).toBe(1);
});

test("最新版本和检查失败可重新检查", async ({ page }) => {
  await page.goto("/#/settings");
  await page.evaluate(() => { (window as any).updaterTest.mode = "offline"; });
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(page.getByText(/检查更新失败/)).toBeVisible();
  await page.evaluate(() => { (window as any).updaterTest.mode = "latest"; });
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(page.getByText("当前已是最新版本。", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("启动检查自动提醒", async ({ page }) => {
  await page.goto("/#/settings");
  await expect(page.getByRole("dialog")).toContainText("发现新版本 0.2.13", { timeout: 15_000 });
  expect(await page.evaluate(() => (window as any).updaterTest.checks)).toBe(1);
});
