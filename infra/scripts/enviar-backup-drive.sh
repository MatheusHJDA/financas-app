#!/usr/bin/env bash
# Envia ao Google Drive o backup mais recente da VPS (cópia fora do servidor; a outra vai para o PC).
# Roda pelo cron do usuário ubuntu às 04:00 (depois do backup das 03:00):
#   0 4 * * * $HOME/financas/infra/scripts/enviar-backup-drive.sh
#
# Remoto rclone `gdrive` com escopo drive.file (o app só vê os arquivos que ele mesmo criou), pasta
# `financas-backups`. Confere o envio (md5 do Drive) e apaga do Drive os dumps com mais de 30 dias pela data
# do nome. Log em ~/backups/drive.log; o último sucesso fica em ~/backups/.drive-ok (o PC avisa se envelhecer).
set -euo pipefail

REMOTO="${REMOTO:-gdrive:financas-backups}"
DIAS="${DIAS:-30}"
LOG="$HOME/backups/drive.log"
OK="$HOME/backups/.drive-ok"
TMP="$HOME/.backup-drive"

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
mkdir -p "$HOME/backups"
COMPOSE=(docker compose -f infra/docker-compose.yml -f infra/docker-compose.vps.yml --env-file .env)

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }
falha() { log "FALHA: $*"; rm -rf "$TMP"; exit 1; }

caminho="$("${COMPOSE[@]}" exec -T backup sh -c 'ls -1 /data/backups/financas-*.dump 2>/dev/null | tail -n 1' || true)"
nome="$(basename "${caminho:-x}")"
[[ "$nome" =~ ^financas-[0-9]{8}-[0-9]{6}\.dump$ ]] || falha "nenhum backup no volume (resposta: '$caminho')."

if rclone lsf "$REMOTO" --include "$nome" 2>/dev/null | grep -qx "$nome"; then
  log "já estava no Drive: $nome"
else
  rm -rf "$TMP" && mkdir -m 700 -p "$TMP"
  "${COMPOSE[@]}" cp "backup:/data/backups/$nome" "$TMP/$nome" || falha "não consegui separar $nome do volume."
  rclone copy "$TMP/$nome" "$REMOTO" || falha "o envio de $nome ao Drive falhou."
  rclone check --one-way "$TMP" "$REMOTO" --include "$nome" 2>/dev/null || falha "$nome no Drive não confere (md5)."
  rm -rf "$TMP"
  log "enviado ao Drive: $nome (md5 ok)"
fi

limite="$(date -d "-$DIAS days" +%Y%m%d)"
while IFS= read -r f; do
  [[ "$f" =~ ^financas-([0-9]{8})-[0-9]{6}\.dump$ ]] || continue
  if [[ "${BASH_REMATCH[1]}" < "$limite" ]]; then
    rclone deletefile "$REMOTO/$f" && log "apagado do Drive (mais de $DIAS dias): $f"
  fi
done < <(rclone lsf "$REMOTO" --include 'financas-*.dump' 2>/dev/null || true)

echo "$(date +%Y-%m-%d) $nome" > "$OK"
