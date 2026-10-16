# 当前虚拟机部署记录（2026-10-16，版本化 API 与设备推理支持）

2026-10-16 已部署 `codex/client-server-split` 分支源码快照，包含同页验证码表单修正。源码包 SHA-256：`f2a725d03bea370b6b9caa5abe44240b062a44cba4aa43d27c48b372616ce7f0`。Compose 项目和 PostgreSQL/应用数据卷保持不变；源码位于 `/root/novel-upload/novel-vm-d5b9218e/web`，应用镜像 ID `sha256:66b0a16d6c8d6efa003fddf7c18a4d8e9e9ae206d26fe7582001d2d37e48fef8`。容器创建时间为 `2026-10-16T06:15:30Z`，健康检查通过。

部署前备份：`/root/novel-selftest-20261015-313fc7ac/backups/novel-20261016T055422Z-H48o0n`，包含 `COMPLETE` 标记，数据库及文件归档 SHA-256 校验通过。

## 旧小说迁入（2026-10-16）

- 本机 SQLite 使用在线备份生成独立快照，2 个原文件复制后与源文件 SHA-256 一致；源数据保留在本机。
- VM 迁移前备份：`/root/novel-selftest-20261015-313fc7ac/backups/novel-20261016T060432Z-DjJ7Wc`；目标只有 1 个已验证账号，业务表为空。
- 迁入 2 个项目、718 章、77 条记忆、3 个续写方向、3 份草稿、6 条分析运行记录、15 条记忆提案及 2 个原文件（4,419,787 字节）。迁移工具核对目标记录、正文和文件哈希，完成清单已写入；重新部署后再次核对 2 个文件的 SHA-256 和记录数，两个项目均归属已验证账号。
- 旧模型档案保留非敏感配置；原密钥密文已按迁移规则清空，需在设置页重新录入 API 密钥。页面修正前的迁入数据备份：`/root/novel-selftest-20261015-313fc7ac/backups/novel-20261016T061342Z-i063zk`，数据库和文件归档 SHA-256 校验通过；此备份包含用户小说内容。

## 访问与目录

- 浏览器：`http://192.168.150.102:3000/login`，仅供本人经 VMware 私有网络访问。
- 当前运行源码：`/root/novel-upload/novel-vm-d5b9218e/web`。
- Compose 项目：`novel-selftest-20261015`；数据库未发布宿主机端口。
- 私有配置：沿用旧目录 `/root/novel-selftest-20261015-313fc7ac/source-register-layout-fbea5de3/web/.env.vm`，不进入新源码包。
- 开发分支：`codex/client-server-split`；部署包包含本次同页验证码表单修正，部署记录在后续提交中更新。

## 已完成的实际检查

- 部署包 SHA-256 校验和 VM Node/SQLite 运行时预检通过；PostgreSQL 隔离验证及 SQLite → PostgreSQL 迁移验证通过。
- 新应用和 PostgreSQL 容器健康；`http://192.168.150.102:3000/api/health` 与登录页均返回 HTTP 200，应用容器重启计数为 0。新镜像中的 PostgreSQL 账号/API 隔离与 SQLite → PostgreSQL 迁移验证均通过。
- 修正后的找回密码页和注册页 HTTP 200，初始页面都包含邮箱与验证码输入框；Windows 客户端 `0.1.2` 自测安装包已构建并核对包内文件。

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

当前虚拟机承载 Next.js 网页和 `/api/v1` 服务；Windows 客户端 `0.1.2` 自测安装包固定连接此虚拟机地址。桌面客户端与真实服务的人工端到端体验仍待验收；后续管理平台尚未实现。

## 待完成

邮件找回密码的验证码投递、Redis 校验和密码更新尚待实际验收；注册页及找回密码页修正后的操作体验待人工确认。没有预置账号，也没有绕过邮箱验证。登录入口：`http://192.168.150.102:3000/login`。配置方法见 [部署说明](README.md)。

真实 DeepSeek 调用、分析/续写完整流程、整台虚拟机重启恢复和磁盘告警尚未验收。CentOS 7/内核 3.10 不在当前 Node glibc 官方支持范围内，仅限私下联调。

## 后续维护命令

```bash
cd /root/novel-upload/novel-vm-d5b9218e/web
env_file=/root/novel-selftest-20261015-313fc7ac/source-register-layout-fbea5de3/web/.env.vm
docker compose --env-file "$env_file" -p novel-selftest-20261015 ps
docker compose --env-file "$env_file" -p novel-selftest-20261015 up -d --no-build --wait
```

邮箱配置更新后重建应用容器，使环境变量生效：

```bash
cd /root/novel-upload/novel-vm-d5b9218e/web
env_file=/root/novel-selftest-20261015-313fc7ac/source-register-layout-fbea5de3/web/.env.vm
docker compose --env-file "$env_file" -p novel-selftest-20261015 up -d --no-build --force-recreate app
```

备份时必须使用相同项目名：

```bash
cd /root/novel-upload/novel-vm-d5b9218e/web
env_file=/root/novel-selftest-20261015-313fc7ac/source-register-layout-fbea5de3/web/.env.vm
COMPOSE_PROJECT_NAME=novel-selftest-20261015 bash deploy/backup.sh \
  /root/novel-selftest-20261015-313fc7ac/backups "$env_file"
```
