# Migrar para uma VPS (Docker + Caddy + domínio próprio)

Na VPS o app fica no ar o tempo todo (sem depender do PC ligado), com HTTPS automático pelo Caddy num domínio
seu. Esta página parte do app já funcionando no PC ([deploy-pc.md](deploy-pc.md)).

> ## ⚠️ Aviso importante: a origem do app muda
>
> Ao trocar o endereço `https://<pc>.<tailnet>.ts.net` pelo domínio próprio (`https://financas.seudominio.com.br`),
> o navegador do celular trata como **outro site**. Por isso, em **cada celular** (Matheus, Ruth e o Galaxy A13):
>
> 1. **Reinstale o app (PWA)** a partir do endereço novo (apague o ícone antigo; veja
>    [instalar-no-celular.md](instalar-no-celular.md)).
> 2. **Entre de novo com o PIN** e **reative as notificações** (**Mais → Preferências → Notificações**). As inscrições de push
>    do endereço antigo não valem para o novo.
>
> Os **dados não se perdem**: ficam no servidor (no banco restaurado na VPS). Só o app instalado e a permissão de
> notificação são do endereço. Deixe o PC rodando até todos os celulares estarem no endereço novo.

## 1. O que você precisa

- Uma VPS Linux (Ubuntu/Debian, 1 GB de RAM já serve) com acesso SSH.
- Um domínio (ou subdomínio) com registro **A** apontando para o IP da VPS (por exemplo `financas.seudominio.com.br`).
  Em IPv6, aponte também o **AAAA**.
- Portas **80** e **443** liberadas no firewall da VPS (o Caddy usa as duas para emitir o certificado e servir o app).
- Docker Engine + plugin Compose na VPS ([docs.docker.com/engine/install](https://docs.docker.com/engine/install/)).
- Git.

## 2. Preparar a VPS

```bash
git clone <endereço-do-repositório> financas
cd financas
cp .env.example .env
```

Edite o `.env` (valores fictícios; use os seus):

```
DOMAIN=financas.seudominio.com.br
POSTGRES_PASSWORD=troque-por-uma-senha-longa
DATABASE_URL=postgresql+psycopg://financas:troque-por-uma-senha-longa@db:5432/financas
OPENAI_API_KEY=sk-...
OPENAI_MODEL=<modelo>
# MESMAS chaves do PC — não gere novas (veja a seção 4)
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:seu-email@exemplo.com
INITIAL_PIN_MATHEUS=
INITIAL_PIN_RUTH=
# O domínio novo PRECISA estar aqui, senão toda requisição volta 400 "Invalid host header"
ALLOWED_HOSTS=financas.seudominio.com.br,localhost,127.0.0.1
# Deixe desligado em produção (Swagger em /api/docs só para depurar)
ENABLE_DOCS=false
```

- Use uma senha de banco **nova e forte** (a da VPS não precisa ser igual à do PC; o dump não leva a senha).
- Os PINs iniciais podem ficar vazios: os usuários e seus PINs vêm junto com o banco restaurado.
- `ALLOWED_HOSTS` com o mesmo valor de `DOMAIN` (pode tirar o `*.ts.net` quando o Tailscale sair de cena).
- `chmod 600 .env`.

## 3. Subir (Docker + Caddy)

A VPS usa o compose base **mais** o override `infra/docker-compose.vps.yml`, que fecha a porta 8000 do app e coloca o
Caddy (HTTPS automático em `{$DOMAIN}`, com proxy para a api) na frente:

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.vps.yml --env-file .env up -d --build
docker compose -f infra/docker-compose.yml -f infra/docker-compose.vps.yml --env-file .env ps
```

Abra `https://financas.seudominio.com.br/api/health`. O primeiro acesso demora alguns segundos enquanto o Caddy
obtém o certificado (se não sair, veja `logs caddy`: normalmente é DNS ainda não propagado ou porta 80/443 fechada).

Neste ponto o banco da VPS está vazio (só as tabelas). Falta trazer os dados do PC.

## 4. Migrar os dados do PC para a VPS

1. **No PC**, gere um backup novo e confira o arquivo:

   ```powershell
   ./tasks.ps1 backup .\backups
   ```

   O arquivo é o `financas-AAAAMMDD-HHMMSS.dump` mais novo de `.\backups`.

2. **Combine a data de corte**: a partir daqui, ninguém lança nada no app do PC (qualquer lançamento depois do
   backup ficaria de fora). O mais simples é avisar a Ruth, fazer o backup e só então virar para a VPS.

3. **Copie o dump para a VPS** (do PC, PowerShell):

   ```powershell
   scp .\backups\financas-AAAAMMDD-HHMMSS.dump usuario@IP-DA-VPS:~/financas/
   ```

   O dump tem todos os dados financeiros: na VPS, `chmod 600 ~/financas/financas-*.dump`, e apague-o depois de
   conferir a restauração (o serviço `backup` passa a gerar os seus).

4. **Na VPS**, restaure (o script faz backup de segurança, para a api, restaura e sobe a api):

   ```bash
   cd ~/financas
   infra/scripts/restore.sh financas-AAAAMMDD-HHMMSS.dump --confirmar
   ```

   Se preferir fazer à mão, o núcleo é o `pg_restore --clean --if-exists --no-owner` do `infra/scripts/db-restore.sh`.

5. **Confira**: entre em `https://financas.seudominio.com.br` com o PIN de sempre e compare saldos e quantidade de
   lançamentos com o app do PC.

6. **Mesmas chaves VAPID.** Embora as notificações precisem ser reativadas nos celulares (aviso no topo), use as
   **mesmas** `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` do PC: trocar as chaves invalida todas as inscrições de
   push existentes. Elas estão no `.env` do PC (e no seu gerenciador de senhas).

7. **Anexos (fotos/PDFs enviados)** ficam no volume `uploads`, fora do dump. Se quiser levá-los, copie o volume
   (no PC: `docker run --rm -v financas_uploads:/d -v "${PWD}:/out" alpine tar czf /out/uploads.tgz -C /d .`; na
   VPS: o equivalente com `tar xzf` no volume `financas_uploads`). O app funciona sem eles, mas os comprovantes
   antigos ficam sem imagem.

## 5. Virar a chave

1. Em cada celular: reinstale o app pelo endereço novo e reative as notificações (aviso no topo e
   [instalar-no-celular.md](instalar-no-celular.md)). O Tailscale deixa de ser necessário para o app.
2. Depois que os dois celulares estiverem usando a VPS, pare o app do PC (`./tasks.ps1 down`) e desligue o
   `tailscale serve reset`, para ninguém lançar por engano no banco antigo. Guarde o último dump do PC.

## 6. Backup na VPS

O serviço `backup` do compose já roda na VPS: às **03:00 de São Paulo** grava o dump no volume `backups` (**Mais → Administração →
Sistema** mostra o último) e mantém 14 dias. Além disso:

```bash
infra/scripts/backup.sh ~/backups          # backup agora + cópia na pasta do host
infra/scripts/restore.sh ~/backups/ARQUIVO.dump            # só explica
infra/scripts/restore.sh ~/backups/ARQUIVO.dump --confirmar
```

**Leve cópias para fora do servidor** (VPS que some leva o backup junto): por exemplo um `cron` no host que roda
`infra/scripts/backup.sh` e um `rclone`/`scp` mandando a pasta para outro lugar. Teste a restauração num banco
descartável antes de confiar (veja a seção de teste em [deploy-pc.md](deploy-pc.md#7-backup-e-restauração)).

## 7. Atualizar e operar

```bash
cd ~/financas && git pull
infra/scripts/backup.sh ~/backups
docker compose -f infra/docker-compose.yml -f infra/docker-compose.vps.yml --env-file .env up -d --build
docker compose -f infra/docker-compose.yml -f infra/docker-compose.vps.yml --env-file .env logs api --since 10m
```

Atualize o sistema da VPS regularmente, mantenha só as portas 22, 80 e 443 abertas e proteja o SSH (chave, sem senha).
