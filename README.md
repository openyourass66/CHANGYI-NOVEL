# 长忆 · 小说理解与续写工作台

长忆把长篇小说的导入、章节校对、故事记忆维护和续写整合到一个本机工作台中。原文以只读方式保存，分析结论、记忆和续写草稿单独记录，适合个人管理和延续长篇故事。

已发布 Windows 桌面版：**v0.1.6**；当前源码桌面版本为 **v0.1.7**，包含发行包清理及 PDF 导入兼容性修复。

[下载安装包](https://github.com/openyourass66/CHANGYI-NOVEL/releases/download/v0.1.6/Changyi-Setup-0.1.6-x64.exe) · [版本说明与校验文件](https://github.com/openyourass66/CHANGYI-NOVEL/releases/tag/v0.1.6) · [所有版本](https://github.com/openyourass66/CHANGYI-NOVEL/releases)

## 功能

- **项目与原文**：创建项目，导入 TXT、Markdown、DOCX、EPUB、HTML 和可提取文本的 PDF；自动识别章节，支持调整顺序、修改标题、切分和合并。
- **小说分析**：逐章抽取故事信息、统合全书，查看任务进度、运行记录和待审阅的记忆提案。
- **故事记忆**：维护章节笔记、设定、人物、时间线、悬念、文风、术语和概要；支持条目状态、出处、编辑和历史版本。
- **续写规划**：自定义续写方向，或让模型生成候选；选定方向后排章纲、写草稿、检查连续性，并审阅草稿中的记忆变化。方向的完整说明会用于章纲和正文生成。
- **模型接入**：支持 Anthropic、OpenAI-compatible 服务以及 Ollama、LM Studio 本地端点。云端任务运行前展示数据范围并请求授权；本地端点连接失败时不会回退到云端。
- **备份与导出**：导出项目 JSON、校对后的正文和记忆；可将 JSON 备份恢复为新项目。模型档案及密钥不会进入项目导出。

项目面向单用户本地使用，目前不提供账号或云端同步。扫描版 PDF 的 OCR 暂不支持。

## Windows 桌面版

### 下载安装

1. 从 [v0.1.6 Release](https://github.com/openyourass66/CHANGYI-NOVEL/releases/tag/v0.1.6) 下载 `Changyi-Setup-0.1.6-x64.exe`。
2. 运行安装程序，选择安装位置后启动“长忆”。无需另行安装 Node.js、浏览器或数据库。
3. 首次进入时选择数据保存文件夹。建议使用独立于安装目录的文件夹，例如 `D:\长忆数据`。
4. 在“设置”中配置模型档案。没有模型档案时，也可以创建项目、导入和校对原文、保存自定义续写方向。

仓库目前为私有，下载需要登录有访问权限的 GitHub 账号。安装程序未进行代码签名，Windows 可能显示来源提示；Release 中的 `SHA256SUMS.txt` 可用于核对安装包完整性。

### 升级与更换数据目录

升级后继续使用原来的数据目录，即可打开已有项目。可在“设置 → 数据保存位置”查看当前目录或选择其他文件夹：

| 目标目录 | 应用行为 |
| --- | --- |
| 首次使用时选择空目录 | 创建新的工作区 |
| 当前已有工作区，改选空目录 | 将当前数据复制到目标目录，保留原目录 |
| 选择已有的有效工作区 | 直接打开其中的项目及模型配置 |

选择目录后应用会重新打开工作区，无需选择数据处理方式。旧 Web 项目可以直接选择其 `web/data/` 文件夹；若其中有加密的模型密钥，需保留原项目的 `.env` 或 `.env.local`，程序会读取数据目录及其上一级的配置并校验密钥。

Windows 标题栏与应用导航合并显示，顶部空白区域支持拖动和双击最大化，右侧保留系统窗口按钮。从项目进入设置后，“返回项目”会回到原项目及功能页面，刷新设置页后也保留返回位置；点击左上角“长忆”可打开项目库。

## 使用流程

1. **创建项目并导入原文**：检查章节识别结果，根据需要调整标题、顺序、切分和合并。
2. **积累故事记忆**：在“理解分析”运行逐章抽取，审阅并采纳记忆提案，再按需统合全书。
3. **确定续写方向**：在“续写规划”添加自定义方向，或生成候选方向后选择、编辑。
4. **排章纲与写草稿**：选定方向，配置规划章数和模型，生成章纲并按需编辑，然后生成和编辑正文草稿。
5. **核对并维护记忆**：运行连续性检查，处理待核对的问题；提取草稿中的记忆变化，审阅后再更新故事记忆。

自定义方向的名称选填、方向说明必填，支持直接粘贴构思，包括核心冲突、人物选择、需要回收的伏笔和不希望出现的情节。保存只写入本地，无需模型档案或故事记忆。“保存并排章纲”会选定方向并进入章纲配置，由用户确认后才调用模型；生成章纲和正文仍需先积累故事记忆。

生成的候选方向也可以编辑。已有章纲或草稿时，修改方向会另存为独立的新方向，原有成果继续保留。章纲生成若识别到方向与既有事实的明确冲突，会停止写入并提示作者核对方向说明及相关记忆。

## 数据位置与备份

| 运行方式 | 数据位置 |
| --- | --- |
| 安装后的 Windows 桌面版 | 首次启动或设置页中选择的数据目录，以界面显示的“当前目录”为准 |
| Web / 桌面开发模式 | 默认使用 `web/data/`，数据库由 `DATABASE_URL` 配置，原文与导出文件目录由 `NOVEL_DATA_DIR` 配置 |

桌面工作区包含：

```text
所选数据目录/
├── app.db                    # 项目、章节、记忆、续写内容及模型档案（API 密钥加密）
├── projects/                 # 各项目的原文等文件与导出内容
└── .changyi-storage.json     # 工作区加密配置
```

完整备份工作区时，关闭应用后复制整个数据目录，包括 `.changyi-storage.json`。项目 JSON 导出适合恢复单个项目，完整工作区备份同时保留模型档案与加密配置。

桌面版所选目录记录在 `%APPDATA%\Changyi\app-config.json`，启动诊断位于 `%APPDATA%\Changyi\logs\startup.log`。Web 模式的模型密钥由 `.env` 中的 `APP_ENCRYPTION_KEY` 加密；备份 Web 数据时也需保留对应的密钥配置。

云端模型只在用户确认授权后接收预览中说明的数据；本地模型请求发往配置的端点。`.env`、本机数据库、导入的原文和本地验证产物均不应提交到 Git。

重新导入原文会清除依赖旧原文的章节分析、记忆、续写方向、草稿、连续性问题和记忆提案。已有草稿的方向不能直接重新生成章纲；如需重新生成，可另存为新方向，或先导出并删除该方向的草稿。

## 源码开发

项目以 `web/` 单体应用为维护入口。Windows 桌面壳启动同一套 Next.js 应用，业务页面、API 和 SQLite 数据库共用原有实现。

### 环境与启动

需要 Node.js **22.13 或更高版本**与 **pnpm 11.1.1**。克隆仓库后，在项目根目录执行：

```powershell
Set-Location web
pnpm install
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

编辑 `web/.env`，将 `APP_ENCRYPTION_KEY` 替换为 64 位十六进制字符串，可用下面的命令生成：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

按默认数据位置初始化数据库并启动：

```powershell
New-Item -ItemType Directory -Force data | Out-Null
if (!(Test-Path data/app.db)) { New-Item -ItemType File data/app.db | Out-Null }
pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)，在应用的“设置”页添加模型档案。

| 环境变量 | 用途与默认值 |
| --- | --- |
| `DATABASE_URL` | SQLite 数据库地址，默认 `file:../data/app.db`；相对路径基于 `web/prisma/` 解析 |
| `APP_ENCRYPTION_KEY` | 模型密钥的本机加密主密钥，32 字节，即 64 位十六进制字符串 |
| `NOVEL_DATA_DIR` | 原文与导出文件的根目录，默认 `web/data/` |

自定义 Web 数据目录时，应同时调整 `DATABASE_URL` 和 `NOVEL_DATA_DIR` 并创建相应目录；仅设置 `NOVEL_DATA_DIR` 不会更改数据库位置。打包后的桌面版会根据用户所选目录自动配置这些值。

### 桌面开发与打包

完成上述依赖安装和环境配置后，在 `web/` 下运行：

```powershell
pnpm desktop:dev
```

桌面开发模式会自行启动本机开发服务，复用 Web 项目的配置和数据，无需同时运行 `pnpm dev`。

生成 Windows x64 安装程序：

```powershell
pnpm desktop:dist
```

默认输出目录为 `web/release-desktop/`，其中 `win-unpacked/长忆.exe` 可以直接运行。按版本另行指定输出目录时，产物位于对应的版本子目录，例如本机 v0.1.6 产物在 `web/release-desktop/0.1.6/`。这些构建产物不纳入 Git；已发布版本请从 Release 页面下载。

发行包会排除 Source Map 调试映射和 Prisma 引擎的临时残留，仅保留简体中文及美式英语界面语言包。清理只作用于打包产物，正式运行引擎、许可证、字体和 PDF 字符映射继续保留。

### 检查与测试

在 `web/` 下执行：

```powershell
pnpm lint
pnpm exec tsc --noEmit
pnpm build
pnpm test:continuation
node --test desktop-shell/storage-manager.test.cjs
node --test desktop-shell/packaging-files.test.cjs
```

项目导入与续写集成测试需要先完成生产构建，使用独立的临时数据库和本地模拟模型接口，不读取个人项目或调用真实模型服务。数据目录和发行包清理测试同样使用隔离的临时目录。

打包后还可对实际发行目录中的服务执行同一组集成测试，用于检查运行依赖和 PDF 工作线程定位。以下以版本子目录为例，数据库与小说文件仍使用测试临时目录：

```powershell
$env:CHANGYI_TEST_STANDALONE_DIR = (Resolve-Path 'release-desktop/0.1.7/win-unpacked/resources/standalone').Path
pnpm test:continuation
Remove-Item Env:CHANGYI_TEST_STANDALONE_DIR
```

### 项目结构

```text
.
├── README.md                  # 功能、安装、数据与开发指南
└── web/
    ├── desktop-shell/         # Electron 桌面壳与工作区管理
    ├── scripts/               # 桌面运行资源准备
    ├── tests/                 # 续写方向集成测试
    ├── prisma/                # SQLite 数据模型与迁移
    ├── public/                # 图标等静态资源
    └── src/
        ├── app/               # Next.js 页面和 API
        ├── components/        # 项目、记忆、分析和续写界面
        └── lib/               # 导入、领域逻辑、模型接入与存储
```

每次功能更新或用户可见行为变化，都需同步检查 README 中的流程、配置与限制说明。每项独立工作使用清晰的 Git 提交说明；不要提交本机小说数据、密钥或环境配置。
