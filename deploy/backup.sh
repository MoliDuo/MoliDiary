#!/bin/sh
# Dumps the database every BACKUP_INTERVAL_HOURS and keeps BACKUP_KEEP_DAYS of
# them in /backups. The password comes from POSTGRES_PASSWORD in .env.
set -eu

export PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is not set}"
interval=$(( ${BACKUP_INTERVAL_HOURS:-24} * 3600 ))
keep_days=${BACKUP_KEEP_DAYS:-14}

while true; do
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  target="/backups/diary-daily-$stamp.dump"
  if pg_dump --format=custom --no-owner --no-privileges --file="$target.partial"; then
    mv "$target.partial" "$target"
    echo "backup written: $target"
    find /backups -name 'diary-daily-*.dump' -mtime "+$keep_days" -delete
  else
    rm -f "$target.partial"
    echo "backup failed" >&2
  fi
  sleep "$interval"
done
