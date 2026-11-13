# Rodar o app no PC (Windows + Docker Desktop + Tailscale)

Este é o jeito de rodar agora: o app roda em contêineres Docker no PC do Matheus e os celulares acessam por um
endereço HTTPS privado do Tailscale (`https://<nome-do-pc>.<seu-tailnet>.ts.net`). Só aparelhos logados na mesma
conta do Tailscale conseguem abrir. Nada fica exposto na internet nem na rede da casa.

> **Limite deste modo:** com o PC desligado (ou o Docker parado), o app fica fora do ar. Para ficar sempre
> disponível, migre para a VPS: veja [deploy-vps.md](deploy-vps.md).

Todos os comandos abaixo rodam no **PowerShell**, na pasta do projeto (onde está o `tasks.ps1`).

## 1. Pré-requisitos

- **Docker Desktop** instalado e aberto (ícone da baleia sem aviso de erro).
- **Tailscale** instalado e logado no PC, com **MagicDNS** e **HTTPS** ligados no painel do Tailscale
  (login.tailscale.com → *DNS* → *Enable HTTPS*). Sem HTTPS ligado, o `tailscale serve` não gera o certificado.
- **Git** e o projeto baixado.
- Uma chave da OpenAI (para a ingestão por IA).

## 2. Configurar o `.env`

```powershell
Copy-Item .env.example .env
```

Abra o `.env` e preencha (os valores abaixo são **exemplos fictícios**; nunca versione o `.env` nem cole seus
valores reais em lugar algum):

```
POSTGRES_PASSWORD=troque-por-uma-senha-longa
DATABASE_URL=postgresql+psycopg://financas:troque-por-uma-senha-longa@db:5432/financas
OPENAI_API_KEY=sk-...
OPENAI_MODEL=<modelo>
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:seu-email@exemplo.com
INITIAL_PIN_MATHEUS=123456
INITIAL_PIN_RUTH=654321
```

- A senha de `POSTGRES_PASSWORD` precisa ser **a mesma** dentro do `DATABASE_URL`.
- Chaves de push (VAPID): rode `./tasks.ps1 vapid` e cole as duas linhas impressas no `.env`. **Guarde essas chaves**
  (num gerenciador de senhas): se forem trocadas, cada celular precisa desativar e reativar as notificações. Na
  migração para a VPS use as mesmas.
- Os PINs iniciais (6 dígitos) só servem para criar os usuários na primeira vez; depois o Matheus pode redefini-los
  em **Mais → Painel admin → Usuários**.

## 3. Subir o app

```powershell
./tasks.ps1 up
```

Isso constrói a imagem e sobe três serviços: `db` (PostgreSQL), `api` (o app, porta `127.0.0.1:8000`, só o próprio PC)
e `backup` (backup diário, seção 7). Confira em http://127.0.0.1:8000/api/health (deve responder `ok`).

## 4. Criar os usuários (uma vez)

```powershell
docker compose -f infra/docker-compose.yml --env-file .env exec api python -m finance_api.auth.bootstrap
```

Cria Matheus e Ruth com os PINs do `.env`. Pode rodar de novo sem problema: quem já existe é mantido.

A carga inicial de categorias, contas fixas, dívidas e metas (o *seed*) é opcional e **só deve ser feita depois de
conferir os vencimentos provisórios** em `infra/seed/seed.yaml`. O arquivo já vai dentro da imagem:

```powershell
docker compose -f infra/docker-compose.yml --env-file .env exec api python -m finance_api.seed
```

(Pode rodar mais de uma vez: o que já existe é pulado.)

## 5. Liberar o endereço do Tailscale

Uma vez só, em um PowerShell:

```powershell
tailscale serve --bg 8000
tailscale serve status
```

O `--bg` deixa o `serve` **persistente**: ele continua ativo depois de fechar o terminal e volta sozinho quando o PC
reinicia (o Tailscale guarda a configuração). O `status` mostra o endereço `https://...ts.net` que os celulares
vão usar. Para desligar: `tailscale serve reset`.

## 6. Iniciar junto com o Windows

Para o app voltar sozinho depois de reiniciar o PC, três coisas precisam estar certas:

1. **Docker Desktop**: *Settings → General → Start Docker Desktop when you sign in to your computer*. O Docker
   só sobe depois que você entra no Windows. Para o PC voltar sozinho após queda de energia, ative também o login
   automático do Windows (`netplwiz`), sabendo que isso deixa o PC aberto para quem ligar o aparelho.
2. **Contêineres**: já têm `restart: unless-stopped` no `docker-compose.yml`; sobem com o Docker. (Se você rodou
   `./tasks.ps1 down`, eles ficam parados até o próximo `./tasks.ps1 up`.)
3. **Tailscale**: *Run unattended / Start on login* (padrão do instalador do Windows) e o `tailscale serve --bg`
   da seção 5.

Para o PC não dormir e derrubar o app: *Configurações → Sistema → Energia → Suspender* = **Nunca** (na tomada).

## 7. Backup e restauração

- **Automático:** o serviço `backup` faz, todo dia às **03:00 (São Paulo)**, um `pg_dump` do banco para o volume
  Docker `backups`, em arquivos `financas-AAAAMMDD-HHMMSS.dump`, e apaga os de mais de **14 dias**. Se o PC estava
  desligado às 03:00, o backup do dia sai assim que o serviço volta. O último backup aparece no **painel admin →
  Sistema** (e dá para baixar de lá).
- **Agora, com cópia para fora do Docker:**

  ```powershell
  ./tasks.ps1 backup              # copia para .\backups (pasta ignorada pelo git)
  ./tasks.ps1 backup D:\Backups   # ou para outra pasta
  ```

- **Restaurar** (substitui **todos** os dados atuais pelos do arquivo):

  ```powershell
  ./tasks.ps1 restore .\backups\financas-20261113-030000.dump              # só explica o que faria
  ./tasks.ps1 restore .\backups\financas-20261113-030000.dump -Confirmar   # executa
  ```

  O comando faz um backup de segurança do banco atual (no volume), para a api, restaura numa única transação (se
  falhar, o banco fica como estava) e sobe a api de novo. `-SemSeguranca` pula o backup de segurança (só use se o
  banco atual estiver quebrado). Se o dump for de uma versão mais antiga do app, o banco é atualizado sozinho
  quando a api sobe.
- **Onde ficam os arquivos:** os dumps ficam no volume Docker `financas_backups` (dentro do Docker Desktop, não
  numa pasta comum do Windows) e as cópias de `./tasks.ps1 backup` em `.\backups`. As fotos/PDFs enviados ficam
  no volume `financas_uploads` e **não** entram no dump do banco.
- **Copie os backups para fora desta máquina** (pen drive, disco externo ou um serviço de nuvem seu), pelo menos
  uma vez por semana: backup só no mesmo PC não protege contra disco queimado ou roubo. Um jeito simples:
  `./tasks.ps1 backup D:\Backups` com o disco externo ligado. Os arquivos têm dados financeiros: guarde-os
  com o mesmo cuidado do `.env`.
- **Teste a restauração de vez em quando** (ao menos uma vez antes de confiar no backup): restaure num banco
  descartável, sem tocar no real:

  ```powershell
  docker compose -f infra/docker-compose.yml --env-file .env run --rm -T -e RESTORE_DB=financas_teste -v "${PWD}\backups:/in:ro" backup sh /scripts/db-restore.sh /in/ARQUIVO.dump
  docker compose -f infra/docker-compose.yml --env-file .env exec db sh -c 'psql -U "$POSTGRES_USER" -d financas_teste -c "select count(*) from transactions"'
  docker compose -f infra/docker-compose.yml --env-file .env exec db sh -c 'dropdb -U "$POSTGRES_USER" financas_teste'
  ```

  (troque `ARQUIVO.dump` pelo nome do arquivo e `transactions` por uma tabela do app; compare a contagem com a do
  banco real.)

## 8. Atualizar o app

```powershell
git pull
./tasks.ps1 backup      # boa prática antes de atualizar
./tasks.ps1 up          # reconstrói a imagem e reinicia; as migrações rodam sozinhas ao subir a api
```

Os dados ficam nos volumes e não são perdidos. Depois de uma atualização do front, quem usa o app instalado pode
precisar fechar e abrir o app uma vez.

## 9. Ver logs e estado

```powershell
docker compose -f infra/docker-compose.yml --env-file .env ps
docker compose -f infra/docker-compose.yml --env-file .env logs api --since 10m
docker compose -f infra/docker-compose.yml --env-file .env logs backup --since 24h
```

`logs -f` acompanha ao vivo (Ctrl+C sai). No painel admin → **Sistema** aparecem o estado dos serviços, o agendador
de notificações e o último backup.

## 10. E se o PC reiniciar?

1. Entre no Windows (o Docker Desktop abre sozinho se estiver configurado na seção 6).
2. Espere o Docker Desktop terminar de iniciar (1–2 minutos). Os contêineres sobem sozinhos.
3. Confira: `docker compose -f infra/docker-compose.yml --env-file .env ps` (os três serviços `Up`/`healthy`) e abra
   o endereço `https://...ts.net/api/health` no PC.
4. Se não subiu: `./tasks.ps1 up`. Se o endereço do Tailscale não responde: `tailscale status` e
   `tailscale serve status` (se estiver vazio, rode `tailscale serve --bg 8000` de novo).

Os dados não se perdem em reinicializações; só ficam inacessíveis enquanto o PC estiver desligado.
