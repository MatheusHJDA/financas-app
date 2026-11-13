#!/bin/sh
# Backup do PostgreSQL DENTRO do Docker (serviço `backup` do docker-compose.yml, imagem postgres:16-alpine).
#
#   db-backup.sh loop   fica rodando; todo dia às BACKUP_HOUR (padrão 03h, fuso de São Paulo) faz um backup.
#                       Se o PC estava desligado nessa hora, faz o backup assim que o serviço volta.
#   db-backup.sh once   faz um backup agora e sai (usado por `./tasks.ps1 backup` e por infra/scripts/backup.sh).
#
# Cada backup é `pg_dump -Fc` em BACKUP_DIR/financas-AAAAMMDD-HHMMSS.dump (esse nome EXATO é o que o
# painel admin reconhece). Grava num arquivo temporário e só renomeia ao terminar, então o painel nunca
# vê um arquivo pela metade. Apaga dumps com mais de RETENTION_DAYS dias (padrão 14).
#
# Variáveis: POSTGRES_USER, POSTGRES_DB, PGPASSWORD, PGHOST (do compose); BACKUP_DIR (/data/backups);
# RETENTION_DAYS (14); BACKUP_HOUR (3); COPY_TO (opcional: pasta onde copiar também o arquivo gerado).
set -eu
umask 077

BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
BACKUP_HOUR="${BACKUP_HOUR:-3}"
PGHOST="${PGHOST:-db}"
export PGHOST
STATE_FILE="$BACKUP_DIR/.ultimo-agendado"

log() { echo "[backup $(date '+%Y-%m-%d %H:%M:%S')] $*"; }

do_backup() {
  mkdir -p "$BACKUP_DIR"
  name="financas-$(date +%Y%m%d-%H%M%S).dump"
  final="$BACKUP_DIR/$name"
  tmp="$BACKUP_DIR/.$name.tmp"

  if ! pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$tmp"; then
    rm -f "$tmp"
    log "FALHA: pg_dump não terminou; nenhum arquivo foi criado."
    return 1
  fi
  # arquivo vazio ou ilegível = backup inútil; melhor falhar alto do que guardar lixo
  if [ ! -s "$tmp" ] || ! pg_restore --list "$tmp" > /dev/null 2>&1; then
    rm -f "$tmp"
    log "FALHA: o dump gerado está vazio ou inválido; descartado."
    return 1
  fi
  mv "$tmp" "$final"
  log "backup gravado em $final ($(wc -c < "$final") bytes)"

  if [ -n "${COPY_TO:-}" ]; then
    mkdir -p "$COPY_TO"
    cp "$final" "$COPY_TO/$name"
    # o arquivo no volume é 0600 (root); a cópia vai para a pasta do usuário que rodou o script no host
    chmod 644 "$COPY_TO/$name"
    log "cópia gravada em $COPY_TO/$name"
  fi

  # retenção: só arquivos regulares no padrão; sobras de .tmp antigas também saem
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'financas-*.dump' -mmin +$((RETENTION_DAYS * 1440)) -delete
  find "$BACKUP_DIR" -maxdepth 1 -type f -name '.financas-*.tmp' -mmin +1440 -delete
  echo "ARQUIVO=$name"
}

case "${1:-loop}" in
  once)
    do_backup
    ;;
  loop)
    log "agendador iniciado: backup diário às ${BACKUP_HOUR}h (fuso $(date +%Z)), retenção de ${RETENTION_DAYS} dias."
    while true; do
      hoje="$(date +%Y%m%d)"
      hora="$(date +%H | sed 's/^0*//')"
      ultimo="$(cat "$STATE_FILE" 2> /dev/null || true)"
      if [ "${hora:-0}" -ge "$BACKUP_HOUR" ] && [ "$ultimo" != "$hoje" ]; then
        if do_backup; then
          echo "$hoje" > "$STATE_FILE"
        else
          log "nova tentativa em 10 minutos."
          sleep 600
          continue
        fi
      fi
      sleep 60
    done
    ;;
  *)
    echo "uso: db-backup.sh loop|once" >&2
    exit 2
    ;;
esac
