# 长忆 Web 应用

这是长忆的 Next.js 单体应用，也是 Windows 桌面版共用的业务实现。功能介绍、桌面版下载、数据目录和开发指南统一维护在项目根目录的 [README](../README.md)。

直接使用 Windows 桌面版请前往 [Release 页面](https://github.com/openyourass66/CHANGYI-NOVEL/releases/tag/v0.1.6)，无需配置下面的开发环境。

## 快速启动

需要 Node.js 22.13 或更高版本与 pnpm 11.1.1。在本目录执行：

```powershell
pnpm install
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

先按根目录 README 的说明设置 `.env` 中的 `APP_ENCRYPTION_KEY`，再按默认数据位置初始化并启动：

```powershell
New-Item -ItemType Directory -Force data | Out-Null
if (!(Test-Path data/app.db)) { New-Item -ItemType File data/app.db | Out-Null }
pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm dev
```

自定义数据目录时，需同时调整 `DATABASE_URL` 和 `NOVEL_DATA_DIR`。桌面开发、打包与测试命令见根目录 README。
