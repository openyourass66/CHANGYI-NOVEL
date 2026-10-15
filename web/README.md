# Web 应用

这是小说理解与续写工作台的 Next.js 应用。功能介绍、环境变量说明、本机启动方式和数据隐私约定统一维护在项目根目录的 [README](../README.md)。

## 快速启动

在本目录执行：

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
pnpm install
pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm dev
```

首次启动前，请按根目录 README 的说明设置 `.env` 中的 `APP_ENCRYPTION_KEY`。
