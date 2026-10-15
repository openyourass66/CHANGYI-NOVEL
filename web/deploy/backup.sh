#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "$0")/.."
backup_root=${1:?Usage: bash deploy/backup.sh /absolute/backup-directory}
env_file=${2:-.env.vm}
mkdir -p "$backup_root"
backup_dir=$(mktemp -d "$backup_root/novel-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
compose=(docker compose --env-file "$env_file")
was_running=$("${compose[@]}" ps --status running -q app)
restart_app() {
  if [[ -n "$was_running" ]]; then "${compose[@]}" start app >/dev/null; fi
}
trap restart_app EXIT
if [[ -n "$was_running" ]]; then "${compose[@]}" stop app >/dev/null; fi

"${compose[@]}" exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_dir/database.dump"
"${compose[@]}" run --rm -T --no-deps --entrypoint sh app -c 'tar -C /app/data -czf - .' > "$backup_dir/files.tar.gz"
(cd "$backup_dir" && sha256sum database.dump files.tar.gz > SHA256SUMS)
printf 'complete\n' > "$backup_dir/COMPLETE"
printf 'Backup completed: %s\n' "$backup_dir"
