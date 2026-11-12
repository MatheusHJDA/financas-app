#!/usr/bin/env bash
# Esqueleto de backup (U13 completa). Uso: infra/scripts/backup.sh [diretório-de-destino]
set -euo pipefail

DEST="${1:-./backups}"
RETENTION_DAYS=14
COMPOSE=(docker compose -f infra/docker-compose.yml --env-file .env)

mkdir -p "$DEST"
FILE="$DEST/financas-$(date +%Y%m%d-%H%M%S).dump"

"${COMPOSE[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$FILE"
echo "backup gravado em $FILE"

find "$DEST" -name 'financas-*.dump' -mtime +"$RETENTION_DAYS" -delete
