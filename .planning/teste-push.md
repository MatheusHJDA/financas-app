# Teste manual das notificações (U7)

Todos os comandos rodam no PowerShell, a partir de `C:\Users\regin\Downloads\app-personal-finance`, com o Docker Desktop ligado.
O app é acessado pelo endereço do tailnet: **https://optimousprime.tail6cabb8.ts.net** (o `tailscale serve` já aponta para a porta 8000).

## Parte 1 — Preparar o servidor (uma vez só)

1. **Gerar as chaves de push**
   ```powershell
   ./tasks.ps1 vapid
   ```
   O comando imprime duas linhas, `VAPID_PUBLIC_KEY=...` e `VAPID_PRIVATE_KEY=...`. Abra o `.env` e cole os valores nas linhas que já existem com esses nomes. Em `VAPID_SUBJECT`, você pode pôr `mailto:` seguido do seu e-mail.
   Guarde essas chaves: se você as trocar depois, cada celular precisa desativar e reativar as notificações.

2. **Definir os PINs iniciais** (6 dígitos cada) no `.env`:
   ```
   INITIAL_PIN_MATHEUS=......
   INITIAL_PIN_RUTH=......
   ```

3. **Subir o app com o código novo** (reconstrói a imagem):
   ```powershell
   ./tasks.ps1 up
   ```

4. **Criar os dois usuários** (pode rodar de novo sem problema; quem já existe é mantido):
   ```powershell
   docker compose -f infra/docker-compose.yml --env-file .env exec api python -m finance_api.auth.bootstrap
   ```

5. **(Opcional, para testar vencimentos) Carregar contas, categorias e contas fixas da planilha:**
   ```powershell
   docker compose -f infra/docker-compose.yml --env-file .env cp infra/seed/seed.yaml api:/app/seed.yaml
   docker compose -f infra/docker-compose.yml --env-file .env exec -e SEED_FILE=/app/seed.yaml api python -m finance_api.seed
   ```
   Os vencimentos (`due_day`) do seed são provisórios (pendência sua de confirmar).

6. **Conferir:** abra https://optimousprime.tail6cabb8.ts.net/api/health no navegador do PC; deve responder `{"status":"ok"}` ou parecido.

## Parte 2 — Instalar e ativar em cada celular

Faça no iPhone (Matheus) e no celular da Ruth. O Galaxy A13 ainda precisa do app do Tailscale instalado e logado na mesma conta.

1. Abra **https://optimousprime.tail6cabb8.ts.net**:
   - **iPhone:** pelo **Safari** → botão Compartilhar → **Adicionar à Tela de Início**. Depois **feche o Safari e abra pelo ícone** (no iPhone, push só funciona no app instalado). Se o app já estava instalado de antes, remova e instale de novo para pegar a versão nova.
   - **Android:** pelo **Chrome** → menu ⋮ → **Instalar app** e abra pelo ícone.
2. Entre com o PIN da pessoa.
3. Aba **Mais** → cartão **Notificações** → **Ativar notificações** → **Permitir**.
   Deve aparecer **"Ativadas neste aparelho"**.
   - "Notificações não configuradas no servidor": as chaves VAPID não foram lidas (refaça a Parte 1, passos 1 e 3).
   - "Instale o app na tela de início…": no iPhone, o app foi aberto pelo Safari e não pelo ícone.
   - "bloqueadas": libere em Ajustes do celular → Notificações → Finanças e volte ao app.

## Parte 3 — Testes

Na conta do Matheus: aba **Mais** → **Painel admin**.

| # | O que fazer | O que deve acontecer |
|---|---|---|
| 1 | Seção **Notificações**: a lista de aparelhos inscritos | Aparecem os dois celulares |
| 2 | **Enviar notificação de teste** para Matheus, depois para Ruth | A tela mostra quantos aparelhos receberam (1 cada); chega "Notificação de teste" no celular certo. Faça com o app **fechado** também |
| 3 | Tocar na notificação | Abre o app |
| 4 | Seção **Configurações**: **Horário do resumo diário** = 2 minutos à frente do horário atual → salvar. Esperar | Chega "Hora de enviar as movimentações de hoje" **nos dois** celulares, uma vez só; tocar abre o **Chat** |
| 5 | (Só com o seed carregado) Aba **Geral** → Contas a pagar: veja quantos dias faltam para a próxima conta em aberto (N, de 0 a 10). No admin: **Avisar vencimentos com antecedência** = N e **Horário do aviso de vencimento** = 2 minutos à frente → salvar | Chega o aviso da conta para o dono dela (conta "Ambos" → os dois); tocar abre a aba **Geral** |
| 6 | Voltar as configurações para 21:00, 09:00 e 2 dias | — |

Cada aviso sai **uma vez por dia**. Para repetir o teste 4 no mesmo dia, só no dia seguinte (o servidor registra o que já mandou).

## Se algo não chegar

```powershell
docker compose -f infra/docker-compose.yml --env-file .env logs api --since 10m
```
Procure por "Falha no tick de notificações" ou por erro de envio. No admin, a seção **Sistema** deve mostrar o agendador como ativo.

## Registrar o resultado

Anote no `.planning/STATE.md` (seção "Onda 3"): data, aparelhos e quais testes da tabela passaram. Isso fecha o "Pronto quando" da U7.
