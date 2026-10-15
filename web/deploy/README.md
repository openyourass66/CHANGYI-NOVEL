# 虚拟机本机自测

本次实际部署状态、待验收项和维护命令见 [VM_STATUS.md](VM_STATUS.md)。

当前已记录环境：CentOS 7，内核 `3.10.0-1160.el7.x86_64`，Docker `26.1.4`，Compose `v2.27.1`，4 vCPU / 8 GB；标称 80 GB SSD，实际根分区 48 GB，部署前可用约 44 GB。虚拟机 VMware NAT 网卡 `192.168.150.102/24`，开发机 VMnet8 `192.168.150.1/24`，仅本人通过此私有网络访问。

镜像使用 `node:22-bookworm-slim` 和 OpenSSL，固定摘要 `sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392`（Node `v22.23.3`）。已在该虚拟机验证 Node 内建 SQLite 磁盘写入和密码哈希线程池。此前 Alpine 镜像虽然能输出版本号，但实际 SQLite 写入因 `pwritev2` 返回 `EPERM` 失败，不能用于当前主机。构建时生成 Debian/OpenSSL 3 的 Prisma PostgreSQL 客户端。Node.js 22 glibc 官方要求 kernel >= 4.18，当前 3.10 **不在支持范围内**；运行探测通过仅说明这台虚拟机能继续私下联调。Docker 共用宿主机内核，对外试用前迁至受维护的主机。参考：[Node.js 22 平台表](https://github.com/nodejs/node/blob/v22.x/BUILDING.md#platform-list)、[Prisma 6 引擎平台](https://www.prisma.io/docs/orm/v6/reference/prisma-schema-reference#binarytargets-options)。

## 源码部署包

开发机在 `web/` 执行 `pnpm deploy:package`，得到 `novel-vm.tar.gz` 和同目录的 `.sha256` 文件。包来自当前分支工作区，包含尚未提交的实现，不需要切换或推送 `main`。只选取 Web 代码、模型、迁移、运维脚本和示例配置；真实 `.env*`、小说、数据库、技能目录和生成文件不进入归档。压缩包中的 `DEPLOY_SNAPSHOT.json` 记录分支、基线提交及每个源码文件的哈希。

将这两个文件传到虚拟机的专用目录，校验并解压到新目录，避免覆盖已有程序：

```bash
cd /path/to/uploaded-package
sha256sum -c novel-vm.tar.gz.sha256
mkdir novel-vm-source
tar -xzf novel-vm.tar.gz -C novel-vm-source
cd novel-vm-source/web
bash deploy/preflight.sh
```

在虚拟机 `web/` 目录先运行 `bash deploy/preflight.sh`。它输出配置并拉取一个临时 Node 容器，检查 Node、密码哈希线程池与内建 SQLite 的 WAL 建表、写入和查询；不会挂载小说或密钥。如果发生启动失败、非法指令或线程创建失败，停止部署并保留报错，先解决主机运行时兼容性。

## 首次启动

已有 `.env.vm` 时，可在虚拟机终端交互配置 SMTP（授权码隐藏输入，仅更新 SMTP 配置）：

```bash
docker run --rm -it -v "$PWD:/deployment:Z" -w /deployment \
  node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 \
  node deploy/configure-mail.mjs
```

默认网易 `smtp.163.com:465`，QQ 邮箱改为 `smtp.qq.com:465`。输入客户端授权码；不要输入网页登录密码，也不要把授权码发到聊天或写入命令行参数。配置完成后重新创建应用容器使其生效。

1. 在虚拟机准备本分支源码和独立 `.env.vm`，避免覆盖开发机 `.env`。填入生产示例中的变量：三个独立随机值用于数据库密码、模型加密和会话签名；数据库密码用 64 位十六进制值，避免 URI 转义歧义。设置 `REDIS_URL` 指向虚拟机现有 Redis（默认 `redis://host.docker.internal:6379`）。Redis 若只监听 `127.0.0.1`，容器无法连接；应限制在本机/Docker 网桥可达范围并使用 Redis 已配置的访问控制，不要将 Redis 端口暴露到外部网络。SMTP 使用网易客户端授权码。
2. `APP_BIND_ADDRESS` 只能是回环或经确认的虚拟机私有网卡 IP；`BETTER_AUTH_URL` 填浏览器访问的完整地址。HTTP 仅供当前私有联调；HTTPS 地址自动使用 Secure Cookie。
3. 执行下面的命令。首次构建需要联网下载依赖和 Prisma 引擎，不读取现有 SQLite 或小说数据。

```bash
docker compose --env-file .env.vm config --quiet
docker compose --env-file .env.vm up -d --build
docker compose --env-file .env.vm ps
curl -fsS http://127.0.0.1:3000/api/health
```

如果使用 host-only IP，替换健康检查 URL 的宿主机地址。容器内的健康检查仍使用 `127.0.0.1:3000`。数据库不发布宿主机端口；Compose 轮转应用和数据库日志（每份 10 MB，最多 3 份）。

镜像构建和 PostgreSQL 就绪后，可先在隔离 schema 中跑联调：

```bash
docker compose --env-file .env.vm run --rm --no-deps app pnpm verify:postgres
```

该命令创建随机 `verify_` schema，分别应用 PostgreSQL 迁移，验证两个账号的 API 隔离、会话撤销、限流及 SQLite 迁入 PostgreSQL 的记录/文本/文件哈希，再删除本次测试 schema。文件也仅放在容器 `.verify/` 中。真实项目、账号和模型配置不进入演练；邮件回调使用测试捕获，SMTP 投递还需下一步真实注册验证。

注册本人账号并收取 6 位邮箱验证码，邮箱输入框旁可发送验证码，验证码在当前页面输入并完成注册；然后测试登出及通过验证码找回密码。认证使用 Better Auth 的密码哈希和数据库持久会话；验证码、认证限流及会话缓存写入 Redis，验证码 5 分钟过期，输入错误最多 5 次。所有邮箱流程均使用邮件验证码，不使用邮件操作链接；邮件内容不打印到日志。当前整个实例共用认证限流桶，伪造转发 IP 不能改变限流桶。远程注册前还需要可信代理、机器人防护和邮件监控。参考：[Better Auth 邮箱密码](https://better-auth.com/docs/authentication/email-password)、[限流](https://better-auth.com/docs/concepts/rate-limit)。

## 显式迁移 SQLite 与原文件

先在原电脑停止旧应用，完整复制数据库及文件目录作为回滚副本；若数据目录由 `NOVEL_DATA_DIR` 指定，分别确认数据库与原文件位置。不要对唯一源副本操作。使用停止写入后的备份，保留 SQLite WAL/SHM（若仍存在）并一起复制。先统计 `du -sh` 和 `df -h`，实际挂载分区还要容纳构建镜像、备份与日志。

目标要求：本人账号已经注册并验证邮箱；所有目标业务表为空。不要先配置模型或创建小说。将备份复制到虚拟机的独立目录，例如 `/srv/novel-migration/source-data`，确保容器 UID 1000 可读。数据库源文件位置按实际替换；示例按 `source-data/app.db` 和 `source-data/projects/` 布局。

停止应用后，先仅预检（不写数据库或文件）：

```bash
docker compose --env-file .env.vm stop app
docker compose --env-file .env.vm run --rm --no-deps \
  -v /srv/novel-migration/source-data:/migration-source:ro \
  app pnpm data:migrate --source-db /migration-source/app.db \
  --source-files /migration-source --target-files /app/data \
  --owner-email your-email@example.com
```

确认表数量、文件数量和总字节数后，将同一条 `run` 命令末尾追加 `--apply`。工具只读源 SQLite；检查完整性和外键；拒绝路径越界及符号链接；逐个核对源文件字节数和 SHA-256。所有项目、模型档案显式绑定指定的已验证账号；旧 API 密文清空，模型非敏感字段保留。本地模型标记为设备执行。未结束的任务转为失败并保留原进度，需手动恢复或重跑。

文件采用独占创建，不覆盖现有文件。数据库在单个事务中按关系顺序写入，并核对每表记录数及所有字段的规范化哈希（包含正文）。目标卷会保存一份权限为 0600 的迁移清单，包含文件 key 和哈希；该清单也属于私有数据。

如果预检、复制或数据库事务失败，原始数据保持不变，数据库事务不提交；已复制的文件和清单留在目标目录供核对。不要直接反复执行或删除原副本。检查清单后，使用全新的目标卷/环境再迁移，或针对明确属于失败迁移的目标数据制定清理步骤。工具拒绝非空目标业务库和同名文件。如果输出 `applied: true` 但 `manifestUpdated: false`，数据库已经提交，仅最终清单更新失败，需要核对目标库和文件并补记清单，不能按未迁移处理。

```bash
docker compose --env-file .env.vm start app
```

登录核对项目、章节、记忆、草稿和关联，重新录入外部 API 密钥，再走通导入、阅读、分析、记忆编辑、续写和导出。虚拟机不执行 Ollama/LM Studio 请求，等待 Windows 桌面端提供设备调用。

当前仓库提供迁移逻辑的隔离 SQLite 目标验证；真正的 PostgreSQL 事务、Debian/Prisma 引擎和虚拟机重启恢复必须在此环境实测，不将本机验证当成已部署验收。

## 备份与恢复演练

在虚拟机 `web/` 目录运行：

```bash
bash deploy/backup.sh /mnt/separate-backup .env.vm
```

脚本短暂停止原本运行中的应用，保持数据库与文件一致，生成 PostgreSQL 自定义格式备份、文件压缩包和 SHA-256 清单；成功后写 `COMPLETE`，并恢复原本运行中的应用。失败时保留未完成目录，不将其视为有效备份。备份目录及文件使用私有权限；`.env.vm` 和加密/签名密钥需要通过独立安全渠道另存，不打包进普通源码。备份最好放在其他磁盘或主机。

先在备份目录执行 `sha256sum -c SHA256SUMS`。使用独立 Compose 项目名恢复到全新卷，避免覆盖现有库：

```bash
docker compose --env-file .env.vm -p novel-restore up -d db
docker compose --env-file .env.vm -p novel-restore exec -T db \
  sh -c 'exec pg_restore --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < /absolute/backup/database.dump
docker compose --env-file .env.vm -p novel-restore run --rm -T --no-deps \
  --entrypoint sh app -c 'tar -C /app/data -xzf -' < /absolute/backup/files.tar.gz
APP_PORT=3001 BETTER_AUTH_URL=http://localhost:3001 \
  docker compose --env-file .env.vm -p novel-restore up -d app
```

恢复环境沿用原备份对应的加密密钥和会话签名密钥，检查端口、访问地址与健康状态。核对项目数量、原文件哈希、正文与草稿；登录、导出与模型重新连接验证通过后，才把演练记为完成。不要执行 `down -v` 删除唯一数据卷。

## 服务恢复与容量

服务重启后进程内任务不会自动续跑。数据库中的进度和任务状态保留，界面将失联运行显示为可恢复状态，由用户明确恢复/重试；导入、记忆或原文发生变化后需要重新判断旧任务是否适用。当前只运行单个应用容器，未引入跨进程队列或多实例任务调度。

定期执行 `df -h`、`docker system df`，关注实际挂载分区余量；建议磁盘使用率达到 85% 时处理并预留构建及备份空间。当前提供健康检查和日志轮转，磁盘告警接收渠道尚未配置。部署验收记录需包含：SMTP 送达、两个账号隔离、真实模型核心流程、服务/虚拟机重启、备份恢复和磁盘基线。

更新领域模型时同步维护 `prisma/` 与 `prisma-postgresql/`；SQLite 中 nullable 归属仅为兼容待认领旧数据，PostgreSQL 归属是必填外键。数据库客户端在容器中按 PostgreSQL schema 生成，本机开发按 SQLite schema 生成。
