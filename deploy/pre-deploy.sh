#!/usr/bin/env bash
# Runs before the migration (the deploy script calls it from the app directory). Makes sure the
# database is up, then dumps it so a bad migration can be undone. Keeps the five newest dumps in
# ./backups.
set -euo pipefail

compose() { docker compose --env-file .tag "$@"; }

compose up -d --wait postgres

mkdir -p backups
dump="backups/diary-predeploy-$(date +%Y%m%d-%H%M%S).dump"
compose exec -T postgres pg_dump -U diary -Fc moli-diary-db > "$dump"
echo "[pre-deploy] database dumped to $dump"

ls -1t backups/diary-predeploy-*.dump | tail -n +6 | xargs -r rm --
