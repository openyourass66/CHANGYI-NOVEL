# 当前虚拟机部署记录（2026-10-15，邮箱全验证码流程）

2026-10-16 仓库已开始 Windows 客户端与版本化 API 拆分；此文件仍记录上次实际部署，虚拟机尚未更新这批源码。连接新版客户端前，需部署包含共享契约的新源码包并应用设备推理表 migration。

## 访问与目录

- 浏览器：`http://192.168.150.102:3000/login`，仅供本人经 VMware 私有网络访问。
- 当前运行源码：`/root/novel-selftest-20261015-313fc7ac/source-register-layout-fbea5de3/web`。
- Compose 项目：`novel-selftest-20261015`；数据库未发布宿主机端口。
- 私有配置：当前运行目录的 `.env.vm`，权限 0600；包含 Redis 连接配置，不进入源码包。
- 开发分支：`feat/vm-deployment`，未提交、未推送；main 保持原提交。

## 已完成的实际检查

- Debian Node 22.23.3 镜像构建、TypeScript 编译、Prisma PostgreSQL 引擎运行。
- Redis 邮箱验证码版本已切换上线；应用与 PostgreSQL 容器 healthy，`/api/health` 返回 `{"status":"ok"}`，登录页可访问。
- Redis 连接配置已写入私有 `.env.vm`；凭据未输出或写入源码。验证码使用 Redis 短期存储，邮箱仍通过现有 SMTP 发送。
- 注册页和找回密码页均使用同页验证码流程；注册页字段顺序为昵称、密码、确认密码、邮箱、验证码，验证码框默认显示，发送按钮位于邮箱输入框旁。发送验证码仍要求先填写昵称和有效密码。传统邮件链接找回入口已停用。
- 上一版真实邮箱验证码投递、Redis 校验和最终注册已由用户确认通过；本次页面布局改版已构建、部署，并确认页面包含邮箱验证码输入框。
- PostgreSQL 独立临时 schema 内的账号验证、双账号 API/页面隔离、模型归属、密码重置及会话撤销、CSRF、持久限流。
- SQLite → PostgreSQL 隔离迁移演练：记录、关系、正文和文件哈希；旧模型密文清空，源数据保持不变。
- 开发机访问健康接口返回 HTTP 200，应用和数据库健康检查通过。
- 应用及数据库容器重启后，专用测试记录和文件保留。
- 备份 SHA-256 校验；在独立 Compose 项目的全新卷中恢复数据库和文件，核对测试内容，恢复后的应用健康检查通过。
- 演练结束删除专用测试 schema 和测试文件，恢复演练容器已停止，卷保留。现有 Redis/MySQL 未改动。
- SMTP 配置已私下保存，文件权限 0600；连接、TLS、邮箱认证、真实注册验证码邮件投递、Redis 验证码校验及最终注册均已通过（用户实测）。

账号注册和重置密码统一要求 6～20 个字符；登录保留对已有较长密码的兼容。

本次切换前的部署备份：`/root/novel-selftest-20261015-313fc7ac/backups/novel-20261015T115836Z-MocYsQ`。较早的部署/恢复演练备份：`/root/novel-selftest-20261015-313fc7ac/backups/novel-20261015T113025Z-wXBTot`、`/root/novel-selftest-20261015-313fc7ac/backups/novel-20261015T102344Z-z66XVa`。均不包含用户原有小说。

当前虚拟机承载的是整个 Next.js 测试应用（网页界面和 API），这是现有代码的临时联调部署，并非已完成的“云端服务 + 桌面客户端”拆分；桌面客户端和后续管理平台尚未实现。

## 待完成

邮件找回密码的验证码投递、Redis 校验和密码更新尚待实际验收；注册页此次调整后的操作体验也待再次确认。没有预置账号，也没有绕过邮箱验证。登录入口：`http://192.168.150.102:3000/login`。配置方法见 [部署说明](README.md)。

旧小说尚未迁入；需先完成真实邮箱验证，再绑定指定账号迁移。真实 DeepSeek 调用、分析/续写完整流程、整台虚拟机重启恢复和磁盘告警尚未验收。CentOS 7/内核 3.10 不在当前 Node glibc 官方支持范围内，仅限私下联调。

## 后续维护命令

```bash
cd /root/novel-selftest-20261015-313fc7ac/source-register-layout-fbea5de3/web
docker compose --env-file .env.vm -p novel-selftest-20261015 ps
docker compose --env-file .env.vm -p novel-selftest-20261015 up -d --no-build --wait
```

邮箱配置更新后重建应用容器，使环境变量生效：

```bash
docker compose --env-file .env.vm -p novel-selftest-20261015 up -d --no-build --force-recreate app
```

备份时必须使用相同项目名：

```bash
COMPOSE_PROJECT_NAME=novel-selftest-20261015 bash deploy/backup.sh \
  /root/novel-selftest-20261015-313fc7ac/backups .env.vm
```
