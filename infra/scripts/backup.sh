#!/usr/bin/env bash
# Backup agora (para a VPS/Linux; no PC com Windows use `./tasks.ps1 backup`, que faz a mesma coisa).
# Uso: infra/scripts/backup.sh [pasta-de-destino-no-host]   (padrão: ./backups, fora do git)
#
# Faz um `pg_dump -Fc` no volume `backups` do Docker (o mesmo que o painel admin lê, nome
# financas-AAAAMMDD-HHMMSS.dump) e copia o arquivo para a pasta do host. O backup diário automático
# é o serviço `backup` do docker-compose.yml (03:00 de São Paulo, retenção de 14 dias).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
DEST="$(mkdir -p "${1:-./backups}" && cd "${1:-./backups}" && pwd)"
COMPOSE=(docker compose -f infra/docker-compose.yml --env-file .env)

"${COMPOSE[@]}" run --rm -T -e COPY_TO=/host-backups -v "$DEST:/host-backups" backup sh /scripts/db-backup.sh once
echo "cópia no host: $DEST"
