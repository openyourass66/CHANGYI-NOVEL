# Windows 客户端

桌面应用使用本地打包的 React 工作台，通过 `/api/v1` 连接服务端。账号、小说正文和生成结果保存在服务端；Ollama / LM Studio 在当前 Windows 设备执行。浏览器工作台保留，桌面运行时不启动 Next.js、Prisma、数据库、Redis 或 SMTP。

## 开发和运行

需要 Node.js 22.20+、pnpm 11.1.1、Windows x64。源码阶段复用 `../web/src/components`，先安装两侧依赖：

```powershell
Set-Location web
pnpm install
Set-Location ../desktop
pnpm install
pnpm dev
```

`pnpm dev` 启动本机 Vite 并打开 Electron。服务端独立运行；也可以连接更新后的虚拟机服务。首次启动填写服务根地址，例如 `http://192.168.150.102:3000`，然后使用邮箱账号登录。HTTP 限于本机和私有网络自测，其他地址要求 HTTPS。登录后使用项目库、导入、章节阅读、分析、记忆、续写和导出。

生产界面构建与运行：`pnpm build`，然后 `pnpm start`。Windows 安装包：`pnpm pack:win`，输出到 `release/Changyi-0.1.0-Setup.exe` 并生成 SHA-256 文件；打包后自动核对运行代码、界面产物和私有文件排除情况，可用 `pnpm check:package` 重复检查。当前是未签名的自测安装包，尚未配置自动更新或发布渠道；不上传安装包、凭据或小说到 Git。

## 本机模型

在设置中选择 Ollama、LM Studio，或者标为本地的 OpenAI-compatible 档案，填写当前电脑的模型名和地址，保存并测试。允许的主机为 `localhost`、`127.0.0.1`、`::1`；默认端口分别为 11434 和 1234，协议使用 `/v1/chat/completions`。本机模型服务需要先启动。

服务端只保存档案的非敏感元数据。桌面端不向服务器提交本地地址和密钥；地址、可选密钥按服务地址、登录账号和档案分别保存。其他设备需重新配置本机连接。本地模型启动分析前会校验当前设备已有档案，连接失败不会回退到云端。

本机任务由服务端生成请求，桌面端领取并调用本机模型，再回传结果。结构校验、出处定位、提案和草稿落库仍由服务端处理。工作项绑定账号、启动设备、一次性领取凭据和 180 秒截止时间，处理完成后删除临时消息副本；取消后不接受旧结果。设备失败保留尚未完成单元，可在同一设备恢复任务。关闭客户端后本机推理会中止；若连接意外中断，服务端最长等待 180 秒后显示失败，再打开客户端恢复。

## 凭据与原生权限

登录 Cookie 和本机模型密钥由主进程管理，通过 Electron `safeStorage` 使用 Windows 系统加密后保存在 `app.getPath("userData")` 下；没有明文存储降级。页面收不到 Cookie、认证 token 或本机 API 密钥。加密文件不能作为跨 Windows 账号迁移凭据的方式。

客户端启用 sandbox、contextIsolation 和 webSecurity，关闭 nodeIntegration；只加载本地打包的界面，限制 IPC 来源、请求路径、导航和新窗口。服务地址由用户设置，原生网络层仅向这一地址发送账号 Cookie，拒绝重定向；本地推理使用独立请求，不携带账号 Cookie。

## 检查

```powershell
pnpm check
pnpm build
pnpm smoke
```

`check` 检查目的地址、路径、Cookie 隔离、登出和重定向边界。`smoke` 用独立临时目录、内存 HTTP 服务和模拟模型启动隐藏窗口，检查实际打包界面、沙箱、Windows 凭据加密、登录恢复和本机推理；不访问真实小说。

完整桌面到服务端联调：先构建两侧，然后在 `web/` 执行 `pnpm verify:desktop`。它建立隔离 SQLite、认证 Redis 协议测试替身和本机模型替身，通过真实 Next.js API 与 Electron 走通登录、multipart 导入、阅读、设备任务执行、提案、记忆编辑、续写视图和导出。测试结果与截图保存在各侧 `.verify/`；真实 PostgreSQL、Redis、SMTP、外部模型供应商和 Ollama/LM Studio 仍需在目标环境实测。

## 框架选择

Windows 首版采用 Electron：现有 React/TypeScript 组件和 Node HTTP 逻辑可以直接复用，当前开发机已有 Node 工具链。Tauri 需要补充 Rust、MSVC 和 WebView2 构建环境；现阶段优先验证完整客户流程。该选择已通过本地打包界面和 Windows 安全存储探测；移动端、其他桌面系统和管理平台后续评估。

参考：[Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security)、[safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)、[Tauri 环境要求](https://v2.tauri.app/start/prerequisites/)。
