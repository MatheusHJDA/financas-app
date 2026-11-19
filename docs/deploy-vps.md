# Migrar para uma VPS (Docker + Caddy + domínio próprio)

Na VPS o app fica no ar o tempo todo (sem depender do PC ligado), com HTTPS automático pelo Caddy num domínio
seu. Esta página parte do app já funcionando no PC ([deploy-pc.md](deploy-pc.md)).

> ## ⚠️ Aviso importante: a origem do app muda
>
> Ao trocar o endereço `https://<pc>.<tailnet>.ts.net` pelo domínio próprio (`https://app.seudominio.com.br`),
> o navegador do celular trata como **outro site**. Por isso, em **cada celular** (Matheus, Ruth e o Galaxy A13):
>
> 1. **Reinstale o app (PWA)** a partir do endereço novo (apague o ícone antigo; veja
>    [instalar-no-celular.md](instalar-no-celular.md)).
> 2. **Entre de novo**: nome, PIN e a **chave de acesso do aparelho** (Face ID, digital ou Windows Hello). No primeiro
>    acesso pelo endereço novo ninguém tem chave ainda: cada aparelho entra com um **código de liberação** (passo a
>    passo na seção 4, "Primeiro acesso"). Depois **reative as notificações** (**Mais → Preferências → Notificações**).
>    As inscrições de push do endereço antigo não valem para o novo.
>
> Os **dados não se perdem**: ficam no servidor (no banco restaurado na VPS). Só o app instalado e a permissão de
> notificação são do endereço. Deixe o PC rodando até todos os celulares estarem no endereço novo.

## 1. O que você precisa

> **Antes de tudo:** prepare e proteja o servidor com o [preparar-vps.md](preparar-vps.md) (SSH só com chave em
> porta alta, firewall, fail2ban, atualizações automáticas, swap, Docker e chave de leitura do GitHub). Esta página
> começa com a VPS já preparada.

- Uma VPS Linux com acesso SSH. A escolhida: Ubuntu 26.04 LTS, 2 vCPU, 4 GB de RAM, 40 GB de SSD, IPv4, França.
  Em VPS pequena (2 GB de RAM ou menos), crie 2 GB de swap **antes** de construir as imagens:
  `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`
  (e uma linha `/swapfile none swap sw 0 0` no `/etc/fstab` para sobreviver ao reinício).
- Um domínio (ou subdomínio) com registro **A** apontando para o IP da VPS (por exemplo `app.seudominio.com.br`).
  **Não publique registro AAAA** (IPv6): o Caddy roda numa rede Docker só IPv4 e, por IPv6, todos os visitantes
  chegariam à api com o mesmo IP (o do Docker), o que estraga os limites de tentativas de login por origem. Operadora
  só IPv6 continua alcançando o app (por NAT64). Confira o IP real depois de subir (seção 4, "Confira").
- Portas **80** e **443** liberadas no firewall da VPS (o Caddy usa as duas para emitir o certificado e servir o app).
- Docker Engine + plugin Compose na VPS ([docs.docker.com/engine/install](https://docs.docker.com/engine/install/)).
- Git.

## 2. Preparar a VPS

```bash
git clone -b master git@github.com:<usuário>/<repositório>.git financas
cd financas
cp .env.example .env
```

Edite o `.env` (valores fictícios; use os seus). **Não** copie o `.env` do PC inteiro: ele pode ter coisas que não
são do app (senhas anotadas); traga só as chaves da OpenAI e as VAPID.

```
DOMAIN=app.seudominio.com.br
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
ALLOWED_HOSTS=app.seudominio.com.br,localhost,127.0.0.1
# Login em duas etapas (PIN + chave de acesso do aparelho). Ligado desde o primeiro dia na VPS
REQUIRE_PASSKEY=true
PASSKEY_RP_ID=app.seudominio.com.br
PASSKEY_ORIGIN=https://app.seudominio.com.br
# Quem pode dizer o IP real do visitante (cabeçalho X-Forwarded-For): só o Caddy
FORWARDED_ALLOW_IPS=*
# Deixe desligado em produção (Swagger em /api/docs só para depurar)
ENABLE_DOCS=false
```

- Use uma senha de banco **nova e forte** (a da VPS não precisa ser igual à do PC; o dump não leva a senha).
- Os PINs iniciais podem ficar vazios: os usuários e seus PINs vêm junto com o banco restaurado.
- `ALLOWED_HOSTS` com o mesmo valor de `DOMAIN` (pode tirar o `*.ts.net` quando o Tailscale sair de cena).
- `PASSKEY_RP_ID` é o domínio (`$DOMAIN`, sem `https://`) e `PASSKEY_ORIGIN` é `https://$DOMAIN`. Se mudar o domínio,
  as chaves cadastradas deixam de valer (cada uma pertence ao domínio em que foi criada).
- `FORWARDED_ALLOW_IPS`: os limites de tentativas de login são por origem (IP). Atrás do Caddy, o IP real vem do
  cabeçalho `X-Forwarded-For`, e o servidor só confia nele se o par que conecta estiver nessa lista. No compose da
  VPS a api **não publica porta**: o Caddy é o único que alcança a api pela rede interna, então `*` é seguro ali.
  Se um dia a api voltar a ter porta publicada, troque por o IP do Caddy, senão qualquer um poderia forjar o IP e
  escapar do limite. O `infra/Caddyfile` fixa `header_up X-Forwarded-For {remote_host}` no `reverse_proxy`: o Caddy
  troca qualquer `X-Forwarded-For` mandado pelo visitante pelo IP de quem conectou de fato.
- `chmod 600 .env`.
- Senha do banco: `openssl rand -hex 24` (só letras e números, não quebra o `DATABASE_URL`).
- Os comandos `docker compose` desta página levam `--env-file .env`: o compose procura o `.env` na pasta do
  primeiro arquivo (`infra/`), não na raiz.

## 3. Subir (Docker + Caddy)

A VPS usa o compose base **mais** o override `infra/docker-compose.vps.yml`, que fecha a porta 8000 do app e coloca o
Caddy (HTTPS automático em `{$DOMAIN}`, com proxy para a api) na frente:

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.vps.yml --env-file .env up -d --build
docker compose -f infra/docker-compose.yml -f infra/docker-compose.vps.yml --env-file .env ps
```

Abra `https://app.seudominio.com.br/api/health`. O primeiro acesso demora alguns segundos enquanto o Caddy
obtém o certificado (se não sair, veja `logs caddy`: normalmente é DNS ainda não propagado ou porta 80/443 fechada).

Neste ponto o banco da VPS está vazio (só as tabelas). Falta trazer os dados do PC.

## 4. Migrar os dados do PC para a VPS

1. **No PC, atualize para esta versão antes do backup de corte**: junte o código no `master` e rode `./tasks.ps1 up`
   (a api aplica as migrações até a **0004** do alembic; confira com
   `docker compose -f infra/docker-compose.yml --env-file .env exec api alembic current`, deve mostrar `0004_login_attempts_source_idx`). Na VPS a api já sobe nessa
   versão e cria as tabelas novas do login em duas etapas; um dump de versão mais antiga (por exemplo, migração
   0002) **não restaura** num banco já atualizado: o `pg_restore --clean` tenta apagar tabelas das quais as novas
   dependem e a restauração inteira é desfeita. O alembic não conserta isso depois.

2. **No PC**, gere um backup novo e confira o arquivo:

   ```powershell
   ./tasks.ps1 backup .\backups
   ```

   O arquivo é o `financas-AAAAMMDD-HHMMSS.dump` mais novo de `.\backups`.

3. **Combine a data de corte**: a partir daqui, ninguém lança nada no app do PC (qualquer lançamento depois do
   backup ficaria de fora). O mais simples é avisar a Ruth, fazer o backup e só então virar para a VPS.

4. **Copie o dump para a VPS** (do PC, PowerShell):

   ```powershell
   scp .\backups\financas-AAAAMMDD-HHMMSS.dump usuario@IP-DA-VPS:~/financas/
   ```

   O dump tem todos os dados financeiros: na VPS, `chmod 600 ~/financas/financas-*.dump`, e apague-o depois de
   conferir a restauração (o serviço `backup` passa a gerar os seus). Os anexos (passo 9) vêm à parte.
   Depois de restaurar, apague as sessões vindas do PC (foram abertas só com PIN):
   `docker compose -f infra/docker-compose.yml -f infra/docker-compose.vps.yml --env-file .env exec db psql -U financas -d financas -c "delete from sessions"`.

5. **Na VPS**, restaure (o script faz backup de segurança, para a api, restaura e sobe a api):

   ```bash
   cd ~/financas
   infra/scripts/restore.sh financas-AAAAMMDD-HHMMSS.dump --confirmar
   ```

   Se preferir fazer à mão, o núcleo é o `pg_restore --clean --if-exists --no-owner` do `infra/scripts/db-restore.sh`.

6. **Primeiro acesso (login em duas etapas).** Com `REQUIRE_PASSKEY=true`, o PIN sozinho não entra mais: é preciso
   também a chave de acesso (Face ID, digital ou Windows Hello) cadastrada no aparelho. Ninguém tem chave logo após
   restaurar o banco, então cada aparelho entra uma vez com um **código de liberação** (24 h, **uso único**: um
   código por aparelho):

   1. Matheus gera o próprio código **no servidor**:

      ```bash
      docker compose -f infra/docker-compose.yml -f infra/docker-compose.vps.yml --env-file .env exec api python -m finance_api.auth.release Matheus
      ```

      No celular: nome, PIN, "Tenho um código de liberação", código, confirmar no aparelho. **Guarde os 8 códigos de
      emergência** que aparecem uma única vez (gerenciador de senhas ou papel guardado).
   2. Para o **PC** (ou outro aparelho do Matheus) é preciso **outro código**, porque o primeiro já foi usado: rode o
      comando acima de novo, ou gere pelo celular já conectado em **Mais → Administração → Usuários → Matheus →
      Chaves e código**. Entre no PC do mesmo jeito.
   3. Matheus gera o código da Ruth em **Mais → Administração → Usuários → Chaves e código**; a Ruth entra e cadastra
      o iPhone (e outro código para cada aparelho a mais).
   4. Confira **Mais → Preferências → Aparelhos** em cada celular.

7. **Confira**: com a chave cadastrada, compare saldos e quantidade de lançamentos com o app do PC. Confira também
   que a api vê o **IP real** de quem conecta (os limites de tentativas dependem disso): no celular, **nos dados
   móveis** (Wi-Fi desligado), comece uma entrada com o PIN **errado** de propósito e confirme no aparelho (conta uma
   falha; não chega perto de travar nada). Depois, na VPS:

   ```bash
   docker compose -f infra/docker-compose.yml -f infra/docker-compose.vps.yml --env-file .env exec db psql -U financas -d financas -c "select source, at from auth_failures order by at desc limit 3"
   ```

   O `source` mais recente tem de ser o IP público do celular (o mesmo que um site "qual é meu IP" mostra nos dados
   móveis), **não** um `172.x.x.x`/`10.x.x.x` (rede do Docker) nem o mesmo IP para todo mundo. Se aparecer o IP do
   Docker, revise `FORWARDED_ALLOW_IPS`, o `header_up` do Caddyfile e se existe registro AAAA no DNS.

8. **Mesmas chaves VAPID.** Embora as notificações precisem ser reativadas nos celulares (aviso no topo), use as
   **mesmas** `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` do PC: trocar as chaves invalida todas as inscrições de
   push existentes. Elas estão no `.env` do PC (e no seu gerenciador de senhas).

9. **Anexos (fotos/PDFs enviados)** ficam no volume `uploads`, fora do dump. Se quiser levá-los, copie o volume
   (no PC: `docker run --rm -v financas_uploads:/d -v "${PWD}:/out" alpine tar czf /out/uploads.tgz -C /d .`; na
   VPS: o equivalente com `tar xzf` no volume `financas_uploads`). O app funciona sem eles, mas os comprovantes
   antigos ficam sem imagem.

## 5. Virar a chave

1. Em cada celular: reinstale o app pelo endereço novo e reative as notificações (aviso no topo e
   [instalar-no-celular.md](instalar-no-celular.md)). O Tailscale deixa de ser necessário para o app.
2. Depois que os dois celulares estiverem usando a VPS, pare o app do PC (`./tasks.ps1 down`) e desligue o
   `tailscale serve reset`, para ninguém lançar por engano no banco antigo. Guarde o último dump do PC.

### Conta do Matheus travada

O primeiro acesso de cada aparelho (código de liberação) está na seção 4, "Primeiro acesso". Só desligue o app do
PC depois de conferir **Mais → Preferências → Aparelhos** em cada celular.

Se a conta do Matheus travar (20 falhas em 1 h; a conta fica travada sem prazo), nenhum outro admin consegue
destravá-la pelo app. No servidor:

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.vps.yml --env-file .env exec api python -m finance_api.auth.release Matheus --desbloquear
```

Depois gere um código novo (comando sem `--desbloquear`) e entre de novo.

## 6. Backup na VPS

O serviço `backup` do compose já roda na VPS: às **03:00 de São Paulo** grava o dump no volume `backups` (**Mais → Administração →
Sistema** mostra o último) e mantém 14 dias. Além disso:

```bash
infra/scripts/backup.sh ~/backups          # backup agora + cópia na pasta do host
infra/scripts/restore.sh ~/backups/ARQUIVO.dump            # só explica
infra/scripts/restore.sh ~/backups/ARQUIVO.dump --confirmar
```

**Cópia no PC (feito):** a tarefa do Windows "Financas - backup da VPS" (`./tasks.ps1 backup-vps-agendar`) roda
`infra/scripts/puxar-backup-vps.ps1` ao entrar no Windows e ao desbloquear a tela; uma vez por dia copia o dump mais
recente da VPS para `backups/vps/` (confere sha256, guarda 30 dias, log em `backups/vps/puxar-backup.log`). Se
falhar, mostra um aviso e tenta de novo no próximo desbloqueio; também avisa se o backup mais novo da VPS tiver mais
de 2 dias. Copiar na hora: `./tasks.ps1 backup-vps`.

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

Atualize o sistema da VPS regularmente e mantenha só a porta do SSH (alta, só chave; ver preparar-vps.md), a 80 e
a 443 abertas.
