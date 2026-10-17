const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const { appendFileSync, mkdirSync } = require("node:fs");
const { randomBytes } = require("node:crypto");
const { mkdir, readFile, writeFile } = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");

app.setName("Changyi");
if (process.env.CHANGYI_USER_DATA_DIR) {
  app.setPath("userData", path.resolve(process.env.CHANGYI_USER_DATA_DIR));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow;
  let webServer;
  let migrationProcess;
  let isQuitting = false;
  let serverFailure;
  let workspaceLoaded = false;

  function log(message) {
    const logDir = path.join(app.getPath("userData"), "logs");
    try {
      mkdirSync(logDir, { recursive: true });
      appendFileSync(path.join(logDir, "startup.log"), `${new Date().toISOString()} ${message}\n`);
    } catch { /* 启动失败时仍通过对话框显示错误。 */ }
  }

  function nodeProcess(entry, args, options) {
    return spawn(process.execPath, [entry, ...args], {
      ...options,
      env: { ...options.env, ELECTRON_RUN_AS_NODE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  const webRoot = path.resolve(__dirname, "..");
  const appResources = process.resourcesPath;
  const runtimeRoot = app.isPackaged
    ? path.join(appResources, "standalone")
    : webRoot;
  const prismaSchema = app.isPackaged
    ? path.join(appResources, "prisma", "schema.prisma")
    : path.join(webRoot, "prisma", "schema.prisma");
  const prismaCli = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "node_modules", "prisma", "build", "index.js")
    : path.join(webRoot, "node_modules", "prisma", "build", "index.js");
  const serverEntry = app.isPackaged
    ? path.join(runtimeRoot, "server.js")
    : path.join(webRoot, "node_modules", "next", "dist", "bin", "next");

  function waitForPort() {
    return new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        probe.close((error) => {
          if (error) reject(error);
          else resolve(address.port);
        });
      });
    });
  }

  async function appEnvironment(port) {
    const env = { ...process.env };
    let dataDir;

    if (app.isPackaged) {
      const userDir = app.getPath("userData");
      dataDir = path.join(userDir, "data");
      const configPath = path.join(userDir, "app-config.json");
      let config;
      try {
        config = JSON.parse(await readFile(configPath, "utf8"));
        if (!/^[a-f0-9]{64}$/i.test(config.encryptionKey)) throw new Error("应用加密密钥格式无效");
      } catch (error) {
        if (error && error.code !== "ENOENT") throw error;
        config = { encryptionKey: randomBytes(32).toString("hex") };
        await mkdir(userDir, { recursive: true });
        await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" }).catch(async (writeError) => {
          if (writeError.code !== "EEXIST") throw writeError;
          config = JSON.parse(await readFile(configPath, "utf8"));
        });
      }
      env.APP_ENCRYPTION_KEY = config.encryptionKey;
      const databasePath = path.resolve(dataDir, "app.db");
      env.DATABASE_URL = `file:${databasePath.replace(/\\/g, "/")}`;
      env.NOVEL_DATA_DIR = dataDir;
      await mkdir(dataDir, { recursive: true });
      await writeFile(databasePath, Buffer.alloc(0), { flag: "wx" }).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
    } else {
      // 开发模式复用 Web 项目本机配置和数据目录。
      const { loadEnvConfig } = require(path.join(webRoot, "node_modules", "@next", "env"));
      const loaded = loadEnvConfig(webRoot);
      Object.assign(env, loaded.combinedEnv);
      dataDir = env.NOVEL_DATA_DIR || path.join(webRoot, "data");
      env.NOVEL_DATA_DIR = dataDir;
    }

    env.NODE_ENV = app.isPackaged ? "production" : "development";
    env.NEXT_TELEMETRY_DISABLED = "1";
    env.PORT = String(port);
    env.HOSTNAME = "127.0.0.1";
    return env;
  }

  function runPrismaMigration(env) {
    return new Promise((resolve, reject) => {
      let output = "";
      const onOutput = (chunk) => {
        output += chunk.toString();
        if (output.length > 12_000) output = output.slice(-12_000);
        log(`database: ${chunk.toString().trimEnd()}`);
      };
      log("database: start");
      const child = migrationProcess = nodeProcess(
        prismaCli,
        ["migrate", "deploy", "--schema", prismaSchema],
        {
          cwd: app.isPackaged ? path.dirname(prismaSchema) : webRoot,
          env,
        },
      );
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("本地数据库升级超时，请查看启动日志。"));
      }, 60_000);
      child.stdout.on("data", onOutput);
      child.stderr.on("data", onOutput);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`无法启动本地数据库升级进程：${error.message}`));
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        migrationProcess = undefined;
        log(`database: exit ${code}`);
        if (code === 0) resolve();
        else {
          const details = output ? `\n${output.trim().slice(-6000)}` : "\n升级进程没有返回诊断信息。";
          reject(new Error(`本地数据库升级失败（退出代码 ${code ?? "未知"}）。${details}`));
        }
      });
    });
  }

  function startServer(port, env) {
    const args = app.isPackaged
      ? []
      : ["dev", "--hostname", "127.0.0.1", "--port", String(port)];
    log(`server: start ${port}`);
    webServer = nodeProcess(serverEntry, args, {
      cwd: runtimeRoot,
      env,
    });
    webServer.stdout.on("data", (chunk) => log(`server: ${chunk.toString().trimEnd()}`));
    webServer.stderr.on("data", (chunk) => log(`server error: ${chunk.toString().trimEnd()}`));
    webServer.once("error", (error) => { serverFailure = error; log(`server spawn failed: ${error.message}`); });
    webServer.once("exit", (code) => {
      if (isQuitting) return;
      const message = `本机工作区服务已停止（退出代码 ${code ?? "未知"}）。`;
      serverFailure = new Error(message);
      log(message);
      if (workspaceLoaded && mainWindow && !mainWindow.isDestroyed()) {
        void dialog.showMessageBox(mainWindow, { type: "error", title: "长忆无法继续运行", message }).then(() => app.quit());
      }
    });
  }

  async function waitForServer(baseUrl) {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (isQuitting) throw new Error("应用启动已取消。");
      if (serverFailure) throw serverFailure;
      try {
        const response = await fetch(baseUrl, { signal: AbortSignal.timeout(2_000) });
        if (response.ok) return;
        if (response.status >= 500) throw new Error(`本机工作区返回 HTTP ${response.status}。`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("本机工作区返回")) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error("本机工作区启动超时，请稍后重试。");
  }

  async function createWindow(baseUrl) {
    const appOrigin = new URL(baseUrl).origin;
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    mainWindow.webContents.on("will-navigate", (event, url) => {
      try {
        if (new URL(url).origin === appOrigin) return;
      } catch {
        // 无效或非 HTTP 地址一律拦截。
      }
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    });
    await mainWindow.loadURL(baseUrl);
    workspaceLoaded = true;
    log(`window: loaded ${mainWindow.webContents.getURL()}`);
  }

  app.whenReady().then(async () => {
    log(`app: start ${app.getVersion()} ${process.execPath}`);
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 980,
      minHeight: 680,
      show: true,
      title: "长忆小说工作台",
      backgroundColor: "#f8f9fc",
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    mainWindow.on("closed", () => { mainWindow = undefined; });
    await mainWindow.loadFile(path.join(__dirname, "splash.html"));

    try {
      const port = await waitForPort();
      const env = await appEnvironment(port);
      await runPrismaMigration(env);
      const baseUrl = `http://127.0.0.1:${port}`;
      startServer(port, env);
      await waitForServer(baseUrl);
      if (mainWindow && !mainWindow.isDestroyed()) await createWindow(baseUrl);
    } catch (error) {
      if (isQuitting) return;
      const userDir = app.getPath("userData");
      const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
      await mkdir(path.join(userDir, "logs"), { recursive: true }).catch(() => {});
      log(detail);
      await dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "长忆启动失败",
        message: error instanceof Error ? error.message : "无法启动本机工作区。",
        detail: "你的项目数据保存在本机用户目录中，没有被删除。",
      });
      app.quit();
    }
  });

  app.on("before-quit", () => {
    isQuitting = true;
    if (migrationProcess) migrationProcess.kill();
    if (webServer) webServer.kill();
  });

  app.on("window-all-closed", () => app.quit());
}
