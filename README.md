# 小说理解与续写工作台

本项目把长篇小说的导入、理解、故事记忆维护和续写流程整合到工作台中。提供 Next.js 服务端与浏览器工作台，以及通过版本化 API 连接服务的 Windows 桌面客户端。原文以只读方式保存；分析结论、记忆和续写草稿单独记录。目前支持账号隔离，面向本人本机与虚拟机自测，尚未完成公网试用验收。

Web 应用不依赖同级的 `novel-continuation` 技能目录，单独克隆本仓库即可运行。应用内的记忆 Markdown 导入器已包含解析逻辑，无需安装该技能目录。

## 功能

- **账号与隔离**：邮箱注册并验证；可使用邮箱+密码或邮箱+验证码登录，注册验证和密码找回均在各自表单内完成。新设密码为 6～20 个字符，已有较长密码仍可登录。项目、子资源和模型档案按账号隔离。密码重置会撤销已有会话。个人信息页可维护姓名、性别、年龄和小说题材偏好，上传 OSS 头像并修改密码。
- **个人信息**：维护姓名、性别、年龄和小说题材偏好，支持修改密码；头像通过服务端安全代理存入阿里云 OSS 私有 Bucket。
- **项目与原文**：创建项目，导入 TXT、Markdown、DOCX、EPUB、HTML 和可提取文本的 PDF；自动识别章节，并可调整章节顺序、标题、切分和合并。
- **小说分析**：逐章抽取故事信息、统合全书，并查看任务进度、运行记录和待审阅的记忆提案。
- **故事记忆**：维护章节笔记、设定、人物、时间线、悬念、文风、术语和概要；条目支持状态、出处、编辑和历史版本。
- **续写工作流**：生成多个续写方向、选择方向、生成和编辑章纲与草稿、运行连续性检查，并将草稿中的变化作为记忆提案审阅。
- **模型设置**：配置 Anthropic、OpenAI-compatible 服务以及 Ollama、LM Studio 本地端点。云端模型运行前会显示数据范围并要求授权；本地端点连接失败时不会回退到云端。
- **独立运营管理端（首期）**：`admin-console/` 是可单独部署的管理网页，调用服务端管理员 API；管理员可查看用户、项目元数据、模型任务状态、操作审计和依赖状态。用户正文、记忆、草稿、提示词和模型响应不对管理端开放。管理员可停用或恢复普通账号，停用时撤销现有会话。
- **备份与导出**：导出项目 JSON、校对后的正文和记忆；可将 JSON 备份恢复为新项目。模型档案及密钥不会进入项目导出。

扫描版 PDF 的 OCR 暂不支持。

## 本机运行

需要 Node.js 22.20+ 与 pnpm（仓库指定 pnpm 11.1.1）。在项目根目录执行：

```powershell
Set-Location web
if (!(Test-Path .env)) { Copy-Item .env.example .env }
pnpm install
```

编辑 `web/.env`：分别为 `APP_ENCRYPTION_KEY` 和 `BETTER_AUTH_SECRET` 生成独立的 64 位十六进制值，配置本机 Redis 地址及网易 SMTP 邮箱和客户端授权码。可用以下命令生成随机值（执行两次）：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

然后初始化本地 SQLite 数据库并启动：

```powershell
pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm dev
```

打开 <http://localhost:3000> 注册账号并收取 6 位邮箱验证码，验证后登录使用。注册、验证码登录和找回密码都在各自页面同时显示邮箱和验证码输入框；验证码在当前页面输入完成操作。验证码、认证限流和会话缓存使用 Redis；账号、密码哈希及持久会话保存在数据库。邮箱验证、密码找回等邮件流程统一使用验证码，不使用邮件链接。`BETTER_AUTH_URL` 必须与浏览器实际访问的完整地址一致。模型档案在「设置」页配置；没有配置模型时，仍可创建项目、导入和校对原文。

升级已有 SQLite 时，先停止旧服务并备份数据库及文件，再运行上述 migration。旧项目和模型档案保持未认领状态，不自动绑定注册者。指定账号完成邮箱验证后，可以显式认领：

```powershell
pnpm data:claim --email your-email@example.com
pnpm data:claim --email your-email@example.com --apply
```

第一条仅输出数量，第二条才绑定尚未归属账号的项目及模型档案；已有其他归属的数据不变。本机认领保留模型密钥，迁往 PostgreSQL 的工具会清空旧密文。

常用检查命令（在 `web/` 目录运行）：

```powershell
pnpm lint
pnpm exec tsc --noEmit
pnpm build
pnpm verify:auth
pnpm verify:migration
pnpm verify:postgres-types
```

两套验证均使用 `.verify/` 下的隔离数据库和测试文件，不访问真实小说数据。账号验证需要先完成生产构建。邮件回调在测试中被捕获，真实 SMTP 投递仍需部署联调；迁移测试使用 SQLite 目标适配器，不能替代 PostgreSQL 和容器实测。

`verify:postgres-types` 会另外生成隔离的 PostgreSQL 客户端，对应用和脚本运行类型检查；不替换本机 SQLite 客户端、不连接数据库。上传虚拟机前可运行 `pnpm deploy:package`，在 `.verify/deploy/` 生成包含当前未提交实现的源码包和 SHA-256 文件；包内含文件清单，排除真实环境配置、数据库、小说、依赖和本地技能目录。

部署容器中可运行 `pnpm verify:postgres`，在数据库的随机独立 schema 内运行账号/API 隔离和 SQLite → PostgreSQL 迁移演练，结束后清理这些测试 schema。它不向实际账号发送邮件，也不读写正式业务表；仍需单独联调 Redis、真实 SMTP 和虚拟机重启恢复。

## Docker 本机自测部署

账号/API 验证默认启动独立的内存 RESP 测试替身，用于检查 Redis 客户端交互和隔离行为，不连接真实认证 Redis。通过 `VERIFY_REDIS_URL` 可指定专用 Redis 实测；部署环境仍需验证真实 Redis 的持久性与过期行为。

`web/compose.yaml` 提供 Next.js 生产构建、PostgreSQL 16、健康检查、自动重启和日志轮转，并连接虚拟机已有的 Redis。数据库及应用文件分别保存在 Docker 持久卷中，数据库不发布宿主机端口，应用默认只绑定 `127.0.0.1:3000`。当前仅供本人本机自测；CentOS 7 不开放公网。部署前核对宿主机内核与 Docker/Compose，具体步骤见 [部署、数据迁移与恢复说明](web/deploy/README.md)。

在 `web/` 目录复制生产环境变量示例并分别生成数据库密码和加密密钥，然后启动：

```powershell
if (!(Test-Path .env.vm)) { Copy-Item .env.production.example .env.vm }
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
docker compose --env-file .env.vm up -d --build
docker compose --env-file .env.vm logs -f app
```

管理端使用独立的数据库管理员身份。先按常规流程创建并验证管理员账号，再在 `web/` 目录执行 `pnpm admin:grant -- admin@example.com super_admin`（将邮箱换成目标账号）。命令默认授予超级管理员；可显式指定 `operator` 或 `observer`。管理员角色授予和调整仅通过受控服务器命令进行。`operator` 可执行普通账号停用/恢复；只有 `super_admin` 可查看审计记录。管理端代码、构建和部署独立于作者工作台，但复用同一服务端数据库和 `/api/admin/*`，通过 `ADMIN_CONSOLE_URL` 配置单一 CORS/认证信任来源。当前版本尚未加入 MFA，管理端仅用于受控环境自测，不应直接开放公网运营。独立运行与部署见 [管理端说明](admin-console/README.md)。

私有虚拟机自测管理端地址为 `http://192.168.150.102:3001/`，使用原有已验证账号登录；该账号已通过唯一账号引导流程获得 `super_admin`。管理网页运行于独立容器，后端继续监听 3000 端口。

升级已部署数据库前，先备份 PostgreSQL 和应用文件，然后部署会自动应用新增的管理员/审计迁移；SQLite 本机数据库需在 `web/` 运行 `pnpm exec prisma migrate deploy`。管理员操作审计只记录操作元数据及手工填写的停用原因，不记录正文、密钥、令牌或模型输入。

运行生成命令三次，将独立值分别填入 `.env.vm` 的 `POSTGRES_PASSWORD`、`APP_ENCRYPTION_KEY` 和 `BETTER_AUTH_SECRET`，并填写 SMTP 配置。将 `REDIS_URL` 指向虚拟机已运行的 Redis；默认示例使用 `redis://host.docker.internal:6379`，Redis 需要允许 Docker 网桥访问。新加密密钥不用于解密旧模型密文；迁移后需重新录入外部 API 密钥。将 `APP_BIND_ADDRESS` 设为回环地址或确认过的 host-only 网卡地址，同时将 `BETTER_AUTH_URL` 设为浏览器实际访问地址。首次启动应用 PostgreSQL 迁移；旧数据通过 `pnpm data:migrate` 显式绑定指定账号并核对记录、正文与文件哈希。停止服务使用 `docker compose --env-file .env.vm down`，不要加 `-v`。

## Windows 客户端

客户端入口位于 `desktop/`，安装包用户安装后直接登录，无需配置服务地址或本机开发环境。当前开发版固定连接 `http://192.168.150.102:3000`；未来生产版由维护者在打包时指定 HTTPS 云服务器地址。源码开发、本机模型、Windows 安装包和检查命令见 [客户端说明](desktop/README.md)。首次连接前先更新服务端源码并备份、应用数据库迁移；新增的设备推理工作表同时提供 SQLite 和 PostgreSQL migration。Docker 启动时自动应用 PostgreSQL migration。

网页和桌面复用工作台组件，桌面运行时只加载本地打包资源，通过 `/api/v1` 访问服务，不需要安装 Node.js 或数据库。云端模型密钥留在服务端；本机模型密钥和登录 Cookie 使用 Windows 安全存储加密保存，不返回页面。项目数据集中存储在服务端，目前没有离线编辑和双向同步。

在 `web/` 运行 `pnpm verify:desktop` 可启动 Windows 隐藏窗口，通过真实 Next.js 接口、隔离数据库、认证 Redis 协议测试替身和本机模型替身，验证登录、上传、阅读、设备推理、提案、记忆保存和导出。两侧需先安装依赖并构建；真实供应商、本机 Ollama/LM Studio 和部署 PostgreSQL 仍需目标环境实测。

## 数据与隐私

- 默认数据库和小说文件位于 `web/data/`；可通过 `NOVEL_DATA_DIR` 指定其他数据目录。
- `web/.env` 中的 `APP_ENCRYPTION_KEY` 用于在本机加密模型 API 密钥。请妥善备份该密钥；丢失后无法解密已保存的模型密钥。
- `.env*` 中的真实配置、本机数据库、导入的小说原文和 `.verify/` 生成文件已加入忽略规则，不应提交到 Git。环境变量示例及不含私有数据的验证脚本随代码维护。
- 云端模型只在用户确认授权后接收预览中说明的数据，由用户提供密钥并承担费用。本机开发可访问本机模型端点；虚拟机不访问用户设备的 localhost，Ollama/LM Studio 通过 Windows 客户端的设备执行协议在当前电脑调用。
- 账号密码与持久会话保存在数据库；验证码、认证限流及会话缓存保存在 Redis。邮箱验证码为 6 位数字，5 分钟过期并限制校验次数；注册、邮箱验证和密码找回都通过邮件验证码，不发送邮件操作链接。浏览器使用 HttpOnly、SameSite Cookie；HTTPS 地址使用 Secure Cookie。认证与数据库日志不输出正文、密码或令牌。
- 当前自测认证采用整个实例共享的 Redis 限流桶。远程试用前需补足可信代理 IP 配置、机器人防护及邮件监控。
- 重新导入原文会清除依赖旧原文的章节分析、记忆、续写方向、草稿、连续性问题和记忆提案。需要保留的项目数据应先导出。
- 已有草稿的续写方向不能直接重生成章纲；请先导出并删除该方向的草稿，避免旧草稿与新章纲错配。

## 项目结构

客户端拆分分支已整理 `/api/v1` 业务接口，以及供网页和桌面共用的 `packages/contracts` 数据类型。工作台数据接口为 `/api/v1/workspaces/:id?view=chapters|analysis|memory|continuation`，设置接口为 `/api/v1/settings`，认证入口为 `/api/v1/auth/*`；旧网页接口继续可用。所有业务接口沿用账号归属校验。共享类型不包含 Prisma、数据库、服务端文件路径或密钥。

Docker 构建上下文现在为仓库根目录，通过根目录 `.dockerignore` 排除真实环境文件、数据库和客户端产物；继续在 `web/` 执行原有 Compose 命令。源码部署包包含 `packages/contracts`，更新时需要使用完整的新源码包。

```text
.
├── README.md                  # 项目说明与运行指南
├── desktop/                   # Windows Electron 客户端、本机模型与安全存储
├── admin-console/             # 独立部署的 Next.js 运营管理网页
├── packages/contracts/        # 共享 API 类型和领域展示结构
└── web/
    ├── prisma/                # SQLite 数据模型与迁移
    ├── prisma-postgresql/     # PostgreSQL 部署模型与迁移
    ├── deploy/                # 虚拟机部署、备份与恢复说明
    ├── scripts/               # 认领、迁移与隔离验证工具
    ├── src/app/               # Next.js 页面和 API
    ├── src/components/        # 项目、记忆、分析和续写界面
    └── src/lib/               # 导入、领域逻辑、模型接入与存储
```

## 开发约定

每次功能更新或用户可见行为变化，都要同步检查并更新本 README 中的功能、流程、配置或限制说明，避免文档与实际行为脱节。每项独立工作使用清晰的 Git 提交说明；不要提交本机小说数据、密钥或环境配置。
