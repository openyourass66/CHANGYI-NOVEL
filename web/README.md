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

首次启动前，请按根目录 README 的说明设置 `.env` 中的 `APP_ENCRYPTION_KEY`、`BETTER_AUTH_SECRET`、`BETTER_AUTH_URL`、`REDIS_URL` 和 SMTP 配置；注册时通过邮件验证码验证邮箱后登录。已有项目需要显式认领。虚拟机使用独立 `.env.vm`，操作步骤见 [部署说明](deploy/README.md)。
