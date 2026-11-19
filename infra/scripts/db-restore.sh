#!/bin/sh
# Restaura um dump `pg_dump -Fc` no PostgreSQL, DENTRO do Docker (imagem postgres:16-alpine).
# Uso: db-restore.sh /caminho/do/arquivo.dump
#
# Chamado por `./tasks.ps1 restore` e por infra/scripts/restore.sh, que antes PARAM a api.
# O restore roda em uma única transação (--single-transaction): se algo der errado, o banco fica como estava.
#
# Variáveis: POSTGRES_USER, POSTGRES_DB, PGPASSWORD, PGHOST (do compose); RESTORE_DB (opcional: banco de
# destino diferente do POSTGRES_DB, útil para testar a restauração num banco descartável).
set -eu

FILE="${1:?uso: db-restore.sh arquivo.dump}"
PGHOST="${PGHOST:-db}"
export PGHOST
TARGET_DB="${RESTORE_DB:-$POSTGRES_DB}"
case "$TARGET_DB" in
  *[!A-Za-z0-9_]*) echo "nome de banco inválido: $TARGET_DB" >&2; exit 2 ;;
esac

[ -s "$FILE" ] || { echo "arquivo não encontrado ou vazio: $FILE" >&2; exit 1; }
pg_restore --list "$FILE" > /dev/null || { echo "não parece um dump válido (pg_dump -Fc): $FILE" >&2; exit 1; }

if [ "$TARGET_DB" != "$POSTGRES_DB" ]; then
  # banco descartável: cria se não existir (nunca mexe no banco real)
  psql -U "$POSTGRES_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$TARGET_DB'" | grep -q 1 \
    || createdb -U "$POSTGRES_USER" "$TARGET_DB"
fi

echo "restaurando em $TARGET_DB ..."
pg_restore -U "$POSTGRES_USER" -d "$TARGET_DB" --clean --if-exists --no-owner --single-transaction "$FILE"
echo "restauração concluída em $TARGET_DB."
