# 小说理解与续写工作台

本项目把长篇小说的导入、理解、故事记忆维护和续写流程整合到一个本机运行的 Web 工作台中。原文以只读方式保存；分析结论、记忆和续写草稿单独记录。项目面向单用户本地使用，目前不提供账号或云端同步。

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
    ├── prisma/                # SQLite 数据模型与迁移
    ├── src/app/               # Next.js 页面和 API
    ├── src/components/        # 项目、记忆、分析和续写界面
    └── src/lib/               # 导入、领域逻辑、模型接入与存储
```

## 开发约定

每次功能更新或用户可见行为变化，都要同步检查并更新本 README 中的功能、流程、配置或限制说明，避免文档与实际行为脱节。每项独立工作使用清晰的 Git 提交说明；不要提交本机小说数据、密钥或环境配置。
