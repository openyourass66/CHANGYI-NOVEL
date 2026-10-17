# 小说理解与续写工作台

本项目把长篇小说的导入、理解、故事记忆维护和续写流程整合到一个本机运行的 Web 工作台中。原文以只读方式保存；分析结论、记忆和续写草稿单独记录。项目面向单用户本地使用，目前不提供账号或云端同步。

项目以 `web/` 单体应用为唯一维护入口；Windows 桌面版通过 `web/desktop-shell/` 启动同一套本机应用。

Web 应用不依赖同级的 `novel-continuation` 技能目录，单独克隆本仓库即可运行。应用内的记忆 Markdown 导入器已包含解析逻辑，无需安装该技能目录。

## 功能

- **项目与原文**：创建项目，导入 TXT、Markdown、DOCX、EPUB、HTML 和可提取文本的 PDF；自动识别章节，并可调整章节顺序、标题、切分和合并。
- **小说分析**：逐章抽取故事信息、统合全书，并查看任务进度、运行记录和待审阅的记忆提案。
- **故事记忆**：维护章节笔记、设定、人物、时间线、悬念、文风、术语和概要；条目支持状态、出处、编辑和历史版本。
- **续写工作流**：生成多个续写方向、选择方向、生成和编辑章纲与草稿、运行连续性检查，并将草稿中的变化作为记忆提案审阅。
- **模型设置**：配置 Anthropic、OpenAI-compatible 服务以及 Ollama、LM Studio 本地端点。云端模型运行前会显示数据范围并要求授权；本地端点连接失败时不会回退到云端。
- **备份与导出**：导出项目 JSON、校对后的正文和记忆；可将 JSON 备份恢复为新项目。模型档案及密钥不会进入项目导出。

扫描版 PDF 的 OCR 暂不支持。

## 本机运行

需要 Node.js 与 pnpm（仓库指定 pnpm 11.1.1）。在项目根目录执行：

```powershell
Set-Location web
if (!(Test-Path .env)) { Copy-Item .env.example .env }
pnpm install
```

编辑 `web/.env`：将 `APP_ENCRYPTION_KEY` 替换为 64 位十六进制字符串。可用以下命令生成：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

然后初始化本地 SQLite 数据库并启动：

```powershell
pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm dev
```

打开 <http://localhost:3000>。模型档案在应用的「设置」页配置。没有配置模型时，仍可创建项目、导入和校对原文。

## Windows 桌面版

桌面版使用 Electron 打开同一套 Next.js 单体应用，并在本机启动服务；无需安装 Node.js、浏览器或数据库。首次启动和设置页的「数据保存位置」都只需选择目标文件夹，无需选择数据处理方式。首次选中空文件夹时创建工作区；更换到空文件夹时自动复制当前数据；选中已有工作区则直接打开其中的数据。要使用旧 Web 项目的数据，可直接选择其 `web/data/` 文件夹。

所选目录包含 `app.db`、`projects/` 和 `.changyi-storage.json`，分别保存数据库、原文等文件和模型密钥的加密配置。完整备份需要保留这三项；迁移时会复制数据并保留原目录，不覆盖目标目录已有的工作区。

在 Windows 开发环境中，进入 `web/` 安装依赖后运行：

```powershell
pnpm install
pnpm desktop:dev
```

生成 x64 安装程序：

```powershell
pnpm desktop:dist
```

安装包输出到 `web/release-desktop/`。桌面壳仅负责启动和显示本地应用，业务页面、数据库和 API 仍由原有 Web 项目提供。

桌面程序、安装快捷方式、启动页、数据目录设置页、应用导航栏和浏览器标签页统一使用深绿色书页图标。

免安装运行可打开 `web/release-desktop/win-unpacked/长忆.exe`。所选目录记录在 `%APPDATA%\Changyi\app-config.json`，启动诊断保存在 `%APPDATA%\Changyi\logs\startup.log`。旧 Web 项目的模型密钥迁移需要保留原 `web/.env`，迁移程序会在原数据目录的上一级读取它并校验加密配置。

常用检查命令（在 `web/` 目录运行）：

```powershell
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

## 数据与隐私

- 默认数据库和小说文件位于 `web/data/`；可通过 `NOVEL_DATA_DIR` 指定其他数据目录。
- `web/.env` 中的 `APP_ENCRYPTION_KEY` 用于在本机加密模型 API 密钥。请妥善备份该密钥；丢失后无法解密已保存的模型密钥。
- `.env`、本机数据库、导入的小说原文和验证脚本已加入忽略规则，不应提交到 Git。
- 云端模型只在用户确认授权后接收预览中说明的数据；本地模型请求直接发往本机端点。
- 重新导入原文会清除依赖旧原文的章节分析、记忆、续写方向、草稿、连续性问题和记忆提案。需要保留的项目数据应先导出。
- 已有草稿的续写方向不能直接重生成章纲；请先导出并删除该方向的草稿，避免旧草稿与新章纲错配。

## 项目结构

```text
.
├── README.md                  # 项目说明与运行指南
└── web/
    ├── desktop-shell/         # Electron Windows 桌面壳
    ├── scripts/               # 桌面运行资源准备
    ├── prisma/                # SQLite 数据模型与迁移
    ├── src/app/               # Next.js 页面和 API
    ├── src/components/        # 项目、记忆、分析和续写界面
    └── src/lib/               # 导入、领域逻辑、模型接入与存储
```

## 开发约定

每次功能更新或用户可见行为变化，都要同步检查并更新本 README 中的功能、流程、配置或限制说明，避免文档与实际行为脱节。每项独立工作使用清晰的 Git 提交说明；不要提交本机小说数据、密钥或环境配置。
