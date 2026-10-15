#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
printf 'Kernel: '; uname -r
printf 'CPU: '; getconf _NPROCESSORS_ONLN
free -m
df -h .
docker version --format '{{.Server.Version}}'
docker compose version
# 仅启动临时运行时容器，不挂载小说或密钥；验证线程池和 SQLite 实际磁盘写入。
runtime_image=$(awk '/^FROM / {print $2; exit}' Dockerfile)
docker run --rm "$runtime_image" node -e 'const c=require("node:crypto"); c.scrypt("probe","probe",32,(e)=>{if(e)throw e;const{DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("/tmp/novel-probe.db");db.exec("PRAGMA journal_mode=WAL; CREATE TABLE probe(id INTEGER); INSERT INTO probe VALUES(1)");if(db.prepare("SELECT count(*) AS n FROM probe").get().n!==1)process.exit(1);db.close();console.log("Node/SQLite runtime probe passed: "+process.version)})'
printf 'Runtime probe passed; Prisma, PostgreSQL, SMTP and core flows still require deployment checks.\n'
