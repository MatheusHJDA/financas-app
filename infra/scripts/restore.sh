#!/usr/bin/env bash
# Restaura um dump do host no banco REAL (para a VPS/Linux; no PC com Windows use `./tasks.ps1 restore`).
# Uso: infra/scripts/restore.sh arquivo.dump --confirmar [--sem-seguranca]
#
# Sem --confirmar, só explica o que faria. Com --confirmar:
#   1. faz um backup de segurança do banco atual (a menos que --sem-seguranca);
#   2. para a api;
#   3. pg_restore --clean --if-exists --no-owner (numa transação: se falhar, o banco fica como estava);
#   4. sobe a api de novo (o alembic migra o banco se o dump for de uma versão mais antiga).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
FILE="${1:?uso: restore.sh arquivo.dump --confirmar [--sem-seguranca]}"
shift
CONFIRMAR=0
SEGURANCA=1
for arg in "$@"; do
  case "$arg" in
    --confirmar) CONFIRMAR=1 ;;
    --sem-seguranca) SEGURANCA=0 ;;
    *) echo "opção desconhecida: $arg" >&2; exit 2 ;;
  esac
done

[ -f "$FILE" ] || { echo "arquivo não encontrado: $FILE" >&2; exit 1; }
FILE="$(cd "$(dirname "$FILE")" && pwd)/$(basename "$FILE")"
COMPOSE=(docker compose -f infra/docker-compose.yml --env-file .env)

if [ "$CONFIRMAR" -ne 1 ]; then
  cat <<EOF
Isto SUBSTITUI todos os dados do banco atual pelo conteúdo de:
  $FILE
Passos: backup de segurança do banco atual, parar a api, pg_restore, subir a api.
Para executar de verdade, rode de novo com --confirmar.
EOF
  exit 0
fi

if [ "$SEGURANCA" -eq 1 ]; then
  echo "==> backup de segurança do banco atual"
  "${COMPOSE[@]}" run --rm -T backup sh /scripts/db-backup.sh once
fi
echo "==> parando a api"
"${COMPOSE[@]}" stop api
trap 'echo "FALHOU. A api continua parada; o banco não foi alterado se o erro foi no pg_restore. Suba de novo com: ${COMPOSE[*]} up -d api" >&2' ERR
echo "==> restaurando"
"${COMPOSE[@]}" run --rm -T -v "$FILE:/restore/arquivo.dump:ro" backup sh /scripts/db-restore.sh /restore/arquivo.dump
echo "==> subindo a api"
"${COMPOSE[@]}" up -d api
echo "restauração concluída a partir de $FILE"
