# 当前虚拟机部署记录（2026-10-16，模型空响应重试修复）

2026-10-16 最新部署：`codex/client-server-split` 分支源码包 `/root/novel-upload/novel-vm-7d434e04/source/web`，SHA-256 `0b14a199a8a5f21e3ff170170696e3b3f9acac77b2990b5f45ad7952502a7785`。应用镜像 `sha256:12182f6cf59d82b53666fde319679d4f5332bef7b174d3fbc5723d96accd3303`，创建于 `2026-10-16T07:05:48Z`，容器 healthy、重启 0 次，`/api/health` 返回 HTTP 200。部署前备份 `/root/novel-selftest-20261015-313fc7ac/backups/novel-20261016T070219Z-zg30Oo` 的数据库和文件归档 SHA-256 均已校验。部署后仍为 2 个项目、718 章、77 条记忆、3 份草稿、2 个原文件、1 个已配置密钥的模型档案，项目归属计数为 2。

本版针对 DeepSeek 官方接口的结构化请求偶发空内容自动重试一次；重试时关闭思考模式并明确要求 JSON 输出。失败任务的“重试”现在会重跑失败单元；旧的零产出失败任务也可从原任务重试。用户要求不恢复本次失败分析，因此未重跑该任务，修复后的真实模型请求效果尚未验收。Windows 客户端安装包无须因本次服务端修改更新。

2026-10-16 已部署 `codex/client-server-split` 分支源码快照，包含同页验证码和操作提示弹窗。源码包 SHA-256：`268a3518db84c1de78e898103b90fb4a03a65e5bcbd05c69b0ed065e0f86f2ae`。Compose 项目和 PostgreSQL/应用数据卷保持不变；源码位于 `/root/novel-upload/novel-vm-84c48f63/source/web`，应用镜像 ID `sha256:0181d02facdc1a16da6b03c6cd8b91278dc584566a3d8722f9cc1b205e5cff44`。容器创建时间为 `2026-10-16T06:43:48Z`，健康检查通过且重启计数为 0。

本次弹窗版本切换前备份：`/root/novel-selftest-20261015-313fc7ac/backups/novel-20261016T064132Z-13ly3x`，数据库与文件归档 SHA-256 均校验通过。Windows 客户端 `0.1.3` 自测安装包已构建并核对 11 项包内文件，SHA-256 为 `cba4b7c823918017665cc32b366d25a191437867b286eb4b839b5cc3e115a232`。

部署前备份：`/root/novel-selftest-20261015-313fc7ac/backups/novel-20261016T055422Z-H48o0n`，包含 `COMPLETE` 标记，数据库及文件归档 SHA-256 校验通过。

## 旧小说迁入（2026-10-16）

- 本机 SQLite 使用在线备份生成独立快照，2 个原文件复制后与源文件 SHA-256 一致；源数据保留在本机。
- VM 迁移前备份：`/root/novel-selftest-20261015-313fc7ac/backups/novel-20261016T060432Z-DjJ7Wc`；目标只有 1 个已验证账号，业务表为空。
- 迁入 2 个项目、718 章、77 条记忆、3 个续写方向、3 份草稿、6 条分析运行记录、15 条记忆提案及 2 个原文件（4,419,787 字节）。迁移工具核对目标记录、正文和文件哈希，完成清单已写入；重新部署后再次核对 2 个文件的 SHA-256 和记录数，两个项目均归属已验证账号。
- 旧模型档案保留非敏感配置；原密钥密文已按迁移规则清空，需在设置页重新录入 API 密钥。页面修正前的迁入数据备份：`/root/novel-selftest-20261015-313fc7ac/backups/novel-20261016T061342Z-i063zk`，数据库和文件归档 SHA-256 校验通过；此备份包含用户小说内容。

## 访问与目录

- 浏览器：`http://192.168.150.102:3000/login`，仅供本人经 VMware 私有网络访问。
- 当前运行源码：`/root/novel-upload/novel-vm-7d434e04/source/web`。
- Compose 项目：`novel-selftest-20261015`；数据库未发布宿主机端口。
- 私有配置：沿用旧目录 `/root/novel-selftest-20261015-313fc7ac/source-register-layout-fbea5de3/web/.env.vm`，不进入新源码包。
- 开发分支：`codex/client-server-split`；最新部署包包含模型空响应和失败任务重试修正。

## 已完成的实际检查

- 部署包 SHA-256 校验和 VM Node/SQLite 运行时预检通过；PostgreSQL 隔离验证及 SQLite → PostgreSQL 迁移验证通过。
- 新应用和 PostgreSQL 容器健康；`http://192.168.150.102:3000/api/health` 与登录页均返回 HTTP 200，应用容器重启计数为 0。新镜像中的 PostgreSQL 账号/API 隔离与 SQLite → PostgreSQL 迁移验证均通过。
- 修正后的找回密码页和注册页 HTTP 200，初始页面都包含邮箱与验证码输入框；Windows 客户端 `0.1.3` 自测安装包已构建并核对包内文件。
- 成功、失败、警告和说明性的操作通知已统一改为居中弹窗，账号页操作反馈也使用同一组件；连续通知排队显示。网页与桌面构建通过，新网页容器健康、接口和找回密码页 HTTP 200；切换后核对迁入业务记录数保持不变。
- 用户在新版找回密码页面完成真实邮箱验证码重置并重新登录。数据库中凭据更新时间早于当前唯一有效会话的创建时间；旧会话已撤销。用新会话访问 `/api/v1/projects` 返回 HTTP 200，仍可见 2 个迁入项目。未查看、记录或索取验证码和新密码。
- 已重新配置并连接检查 DeepSeek 模型档案。使用专用临时项目通过真实 VM API 完成 TXT 导入、逐章分析（16 条提案）、提案采纳、全书统合、续写方向、章纲、草稿、连续性检查（0 条冲突）、草稿记忆提取（10 条提案）和 JSON 导出。验收项目已删除；再次核对仍为 2 个旧项目、718 章、77 条记忆、3 份旧草稿和 2 个原文件。
- 真实模型调用期间，连续性检查和草稿记忆提取各出现一次“模型响应缺少内容”；重试均成功。该外部模型响应的不稳定情况需要后续观察，不能把首次失败算作稳定通过。

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

当前虚拟机承载 Next.js 网页和 `/api/v1` 服务；Windows 客户端 `0.1.3` 自测安装包固定连接此虚拟机地址。桌面客户端与真实服务的人工端到端体验仍待验收；后续管理平台尚未实现。

## 待完成

注册页修正后的人工操作体验尚待确认；Windows 客户端新安装包也待用户安装后体验。没有预置账号，也没有绕过邮箱验证。登录入口：`http://192.168.150.102:3000/login`。配置方法见 [部署说明](README.md)。

整台虚拟机重启恢复和磁盘告警尚未验收。CentOS 7/内核 3.10 不在当前 Node glibc 官方支持范围内，仅限私下联调。

## 后续维护命令

```bash
cd /root/novel-upload/novel-vm-7d434e04/source/web
env_file=/root/novel-selftest-20261015-313fc7ac/source-register-layout-fbea5de3/web/.env.vm
docker compose --env-file "$env_file" -p novel-selftest-20261015 ps
docker compose --env-file "$env_file" -p novel-selftest-20261015 up -d --no-build --wait
```

邮箱配置更新后重建应用容器，使环境变量生效：

```bash
cd /root/novel-upload/novel-vm-7d434e04/source/web
env_file=/root/novel-selftest-20261015-313fc7ac/source-register-layout-fbea5de3/web/.env.vm
docker compose --env-file "$env_file" -p novel-selftest-20261015 up -d --no-build --force-recreate app
```

备份时必须使用相同项目名：

```bash
cd /root/novel-upload/novel-vm-7d434e04/source/web
env_file=/root/novel-selftest-20261015-313fc7ac/source-register-layout-fbea5de3/web/.env.vm
COMPOSE_PROJECT_NAME=novel-selftest-20261015 bash deploy/backup.sh \
  /root/novel-selftest-20261015-313fc7ac/backups "$env_file"
```
