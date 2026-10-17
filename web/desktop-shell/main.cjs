const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const { appendFileSync, mkdirSync } = require("node:fs");
const { mkdir, writeFile } = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { StorageManager } = require("./storage-manager.cjs");
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
  let changingStorage = false;
  let stoppingServer = false;
  let workspaceOrigin;
  let navigationRegistered = false;
  const approvedDirectories = new Set();

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
  const storage = new StorageManager(app.getPath("userData"), [
    path.resolve(process.cwd(), "web/data"), path.resolve(process.cwd(), "data"),
    path.resolve(appResources, "../../../data"),
  ]);

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

  async function appEnvironment(port, config) {
    const env = { ...process.env };
    let dataDir;

    if (app.isPackaged) {
      dataDir = config.dataDir;
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
      if (isQuitting || stoppingServer) return;
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
    workspaceOrigin = new URL(baseUrl).origin;
    if (!navigationRegistered) {
      navigationRegistered = true;
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    mainWindow.webContents.on("will-navigate", (event, url) => {
      try {
        if (new URL(url).origin === workspaceOrigin) return;
      } catch {
        // 无效或非 HTTP 地址一律拦截。
      }
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    });
    }
    await mainWindow.loadURL(baseUrl);
    workspaceLoaded = true;
    log(`window: loaded ${mainWindow.webContents.getURL()}`);
  }

  async function startWorkspace(config) {
    workspaceLoaded = false;
    serverFailure = undefined;
    await mainWindow.loadFile(path.join(__dirname, "splash.html"));
    const port = await waitForPort();
    const env = await appEnvironment(port, config);
    await runPrismaMigration(env);
    const baseUrl = `http://127.0.0.1:${port}`;
    startServer(port, env);
    await waitForServer(baseUrl);
    if (mainWindow && !mainWindow.isDestroyed()) await createWindow(baseUrl);
  }

  async function stopServer() {
    workspaceLoaded = false;
    if (!webServer || webServer.exitCode !== null) return;
    stoppingServer = true;
    const child = webServer;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("工作区未能停止，请关闭应用后重试。")), 10_000);
        child.once("close", () => { clearTimeout(timer); resolve(); });
        child.kill();
      });
    } finally { stoppingServer = false; webServer = undefined; }
  }

  function registerStorageHandlers() {
    const setupUrl = pathToFileURL(path.join(__dirname, "setup.html")).href;
    const handle = (channel, callback) => ipcMain.handle(channel, async (event, ...args) => {
      const url = event.senderFrame?.url;
      if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame ||
          !(url === setupUrl || (workspaceOrigin && new URL(url).origin === workspaceOrigin))) {
        return { ok: false, error: "无法从此页面操作数据目录。" };
      }
      try { return { ok: true, value: await callback(...args) }; }
      catch (error) { return { ok: false, error: error.message }; }
    });
    handle("storage:info", async () => {
      const info = await storage.info();
      for (const source of info.sources) approvedDirectories.add(path.resolve(source.directory));
      approvedDirectories.add(path.resolve(info.dataDir));
      return { ...info, supported: app.isPackaged };
    });
    handle("storage:choose", async (purpose) => {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: purpose === "source" ? "选择原数据目录（包含 app.db 和 projects）" : "选择数据保存目录",
        properties: ["openDirectory", "createDirectory"],
        defaultPath: (await storage.info()).dataDir,
      });
      if (result.canceled) return null;
      approvedDirectories.add(path.resolve(result.filePaths[0]));
      return result.filePaths[0];
    });
    handle("storage:open", async () => {
      const error = await shell.openPath((await storage.info()).dataDir);
      if (error) throw new Error(error);
    });
    handle("storage:apply", async (request) => {
      if (!app.isPackaged) throw new Error("请在打包后的桌面版中更改数据目录。");
      if (changingStorage) throw new Error("正在更改目录，请稍候。");
      if (!request || typeof request.directory !== "string" || !approvedDirectories.has(path.resolve(request.directory))) throw new Error("请先选择保存文件夹。");
      if (!["open", "move", "import"].includes(request.action)) throw new Error("目录操作无效。");
      const previous = await storage.config();
      const previousDir = previous.dataDir ?? path.join(app.getPath("userData"), "data");
      const source = request.action === "move" ? previousDir : request.action === "import" ? request.sourceDirectory : undefined;
      if (request.action === "import" && (typeof source !== "string" || !approvedDirectories.has(path.resolve(source)))) throw new Error("请先选择原数据目录。");
      changingStorage = true;
      try {
        await stopServer();
        const config = await storage.prepare(request.directory, source);
        await startWorkspace(config);
        await storage.save(config);
        return { dataDir: config.dataDir };
      } catch (error) {
        await stopServer();
        if (previous.dataDir) await startWorkspace(previous);
        else await mainWindow.loadFile(path.join(__dirname, "setup.html"));
        await dialog.showMessageBox(mainWindow, { type: "error", title: "数据目录未更改", message: error.message, detail: "原目录的数据已保留。" });
        throw error;
      } finally { changingStorage = false; }
    });
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
      icon: path.join(__dirname, "app-icon-v2.ico"),
      backgroundColor: "#f8f9fc",
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.cjs") },
    });
    mainWindow.on("closed", () => { mainWindow = undefined; });
    await mainWindow.loadFile(path.join(__dirname, "splash.html"));

    try {
      registerStorageHandlers();
      const config = await storage.config();
      if (app.isPackaged && !config.dataDir) await mainWindow.loadFile(path.join(__dirname, "setup.html"));
      else await startWorkspace(config);
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
