# 长忆运营管理端

这是独立部署的管理端网页应用。业务数据和管理员 API 仍由 `web/` 服务托管；浏览器从本应用直接请求该服务，并使用后端设置的 HttpOnly 会话 Cookie。

## 本机开发

1. 配置后端 `web/.env.local`：设置 `ADMIN_CONSOLE_URL=http://localhost:3001`，并确保后端认证密钥、SQLite/PostgreSQL 和 Redis 可用。
2. 在本目录复制 `.env.example` 为 `.env.local`，保留 `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000`。
3. 执行 `pnpm install`、`pnpm dev`，打开 <http://localhost:3001>。

给已验证的管理员用户授予角色：在 `web/` 目录执行 `pnpm admin:grant -- email@example.com super_admin`。

## 独立部署

为此应用单独构建和部署容器，构建时传入 `NEXT_PUBLIC_API_BASE_URL=https://api.example.com`。后端服务设置 `ADMIN_CONSOLE_URL=https://admin.example.com`，并按 `web/` 的部署文档分别设置认证、数据库、Redis 和密钥。推荐将管理端和 API 部署在同一站点下的不同子域名，以兼容浏览器 SameSite Cookie 策略。

管理端不存储账号密码、业务数据库连接串或服务端密钥；管理员通过后端认证，管理 API 每次请求都重新校验角色。启用跨域时只允许配置的单一管理站点来源，并携带凭据。MFA 尚未实现。
