#!/usr/bin/env bash
# Esqueleto de restauração (U13 completa). Uso: infra/scripts/restore.sh arquivo.dump
set -euo pipefail

FILE="${1:?uso: restore.sh arquivo.dump}"
COMPOSE=(docker compose -f infra/docker-compose.yml --env-file .env)

"${COMPOSE[@]}" exec -T db sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < "$FILE"
echo "restauração concluída a partir de $FILE"
