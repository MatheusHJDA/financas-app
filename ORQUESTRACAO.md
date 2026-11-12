# Finanças — Plano de orquestração (v0.2)

> Documento mestre para construir, revisar e ajustar o app com a skill **alethe**.
> Status: **pronto para a Onda 0** (decisões D1–D20). Única checagem pendente: planilha em `docs/referencia/` (P10).
> Data: 12/11/2026 · Responsável (admin): Matheus · Usuários: Ruth e Matheus

---

## 0. Como usar este arquivo

1. O **lead** (Claude Code, Opus) lê este arquivo inteiro antes de qualquer onda.
2. Cada **unidade** (seção 9) vira um item do plano JSON da alethe, com brief no formato de `references/briefs.md`.
3. Os workers recebem **caminhos**, não cópias: o brief aponta para este arquivo (seção relevante) e para `.planning/STATE.md`.
4. Decisões tomadas durante a construção são registradas em `.planning/STATE.md` e, quando mudam o plano, aqui (com data).
5. Toda mudança de rumo é registrada com `orchestrate.py note "<o quê e por quê>" --kind <skip|add|switch|lead>`.

---

## 1. Objetivo

App **pessoal e leve** para o casal controlar o dinheiro no dia a dia e seguir o plano financeiro v2:
quitar o empréstimo o mais rápido possível, não criar gasto novo no cartão, formar reserva e encaixar o plano de saúde.

O app substitui o lançamento manual na planilha `Plano-financeiro-casal-v2.xlsx`. A forma principal de lançar é um **chat**:
o usuário manda texto, foto ou PDF; a IA lê, classifica e propõe os lançamentos; **o usuário confirma antes de gravar**.

### Regras do plano que o app reforça (alertas, nunca bloqueios)
- Cartão de crédito só para recorrentes (Loovi, academia, Cartão de Todos, assinaturas). **Gasto novo no cartão = alerta.**
- Nunca parcelar fatura nem pagar o mínimo.
- Reserva mínima de R$ 2.000; o que passar disso no mês é **sugestão de amortização** do empréstimo.
- Transferências entre contas próprias (ex.: conta da Sonia ↔ conta do Matheus, PJ ↔ PF) **não são receita nem despesa**.

---

## 2. Decisões fechadas

| # | Tema | Decisão |
|---|---|---|
| D1 | Formato | **PWA** instalável (iPhone 11 via Safari "Adicionar à Tela de Início"; Galaxy A13 via Chrome). Sem lojas. |
| D2 | Backend | **Python** (FastAPI). Frontend em TypeScript/React (inevitável no PWA, bom para aprender JS/TS). |
| D3 | Acesso enquanto roda no PC | **Tailscale** (HTTPS no domínio `*.ts.net`). Domínio próprio fica para a VPS. |
| D4 | IA | API da OpenAI. **Sempre confirmar antes de gravar.** Teto de gasto configurado **na própria OpenAI** (hard limit do projeto, ~R$ 30/mês). |
| D5 | Contas bancárias | Cada usuário cadastra as **próprias contas na interface**, com **saldo inicial**. Lançamentos confirmados atualizam os saldos. |
| D6 | Visibilidade | Aba **Geral** com saldos, contas a pagar e movimentações visível aos dois. **Editar/adicionar/excluir é individual**: cada um só altera o que é seu. |
| D7 | Projeção/amortização | Entra na **v1**, com pouca ênfase (tela secundária). |
| D8 | Lembrete diário | **21h, todos os dias, para os dois**, mesmo que já tenham lançado (vira lembrete de verificação). |
| D9 | Vencimentos | Avisos de vencimento de contas a pagar. Camada de notificação **pronta para WhatsApp** no futuro (número dedicado, não o pessoal). |
| D10 | Admin e login | **Matheus é o único admin.** Login por **PIN**. |
| D11 | Orquestração | Claude Code (lead + workers Claude) e **Antigravity (`agy`)** com Gemini, conforme o playbook do print (seção 8.2). |
| D12 (ex-P1) | Registros **Ambos** | **Os dois podem editar e excluir.** Toda alteração fica no log de auditoria. |
| D13 (ex-P2) | Planilha de referência | `Plano-financeiro-casal-v2.xlsx` vai para `docs/referencia/`: fonte da carga inicial e dos **testes de referência** da projeção (U10). |
| D14 (ex-P3) | Amortização | A amortização de R$ 8.000 **ainda não foi feita**. Saldo devedor inicial = valor informado no primeiro uso (contrato atual). O Plano trata a amortização como **pendente** e mostra o efeito de fazê-la. |
| D15 (ex-P4) | Avisos de vencimento | **2 dias antes e no dia**, às 9h (horário editável no admin). |
| D16 (ex-P5) | PIN | **6 dígitos.** |
| D17 (ex-P6) | Acesso | **Tailscale privado** (`tailscale serve`, app Tailscale nos dois celulares). Funnel/público só depois da revisão de segurança (U12). |
| D18 (ex-P7) | Nome do app | **"Finanças"** (nome e nome curto do manifest). |
| D19 (ex-P8) | Commits | O lead faz **um commit por fase**, depois do gate passar e do "ok" do Matheus no chat. |
| D20 (ex-P9) | Donos da carga inicial | **Todas as contas fixas e dívidas da seção 11 são Ambos.** |

---

## 3. Pendências

| # | Pergunta | Proposta padrão |
|---|---|---|
| P10 | Copiar a planilha v2 para `docs/referencia/` (o arquivo não está na pasta do app) | Matheus copia antes da Onda 0; o lead confere na verificação de pré-requisitos. |

---

## 4. Escopo

### 4.1 Dentro da v1
- Login por PIN, sessão longa por aparelho, papéis `admin` (Matheus) e `member` (Ruth).
- **Chat de lançamentos** (tela inicial): texto, imagem (foto/galeria) e PDF → propostas → confirmação em cartões → gravação.
- Lançamento manual (formulário) como alternativa, inclusive quando a IA estiver indisponível ou sem saldo.
- **Contas** por usuário (corrente, poupança, carteira/dinheiro, vale-alimentação, cartão de crédito, empréstimo/dívida) com saldo inicial e saldo atual calculado.
- **Aba Geral**: saldos por conta, contas a pagar (próximas e vencidas), movimentações com filtro **Ruth / Matheus / Ambos / Todos**.
- **Metas** por dono (Ruth / Matheus / Ambos), com progresso automático.
- **Contas a pagar**: recorrentes (contas fixas) geram instâncias mensais com vencimento e status.
- **Notificações**: lembrete diário 21h e avisos de vencimento por Web Push.
- **Painel admin** (seção 6.6).
- **Plano** (ênfase baixa): projeção mês a mês e simulação de amortização (tabela Price), portadas da planilha v2.
- Exportação CSV e backup diário do banco.

### 4.2 Fora da v1 (preparado, não implementado)
- Envio por WhatsApp (interface `NotificationChannel` já existe; canal desativado).
- Integração bancária automática (Open Finance), multi-moeda, modo offline completo.
- Domínio próprio + VPS (só a documentação de migração entra na v1).

---

## 5. Arquitetura

```
iPhone 11 / Galaxy A13  (PWA instalada)
        │  HTTPS  (Tailscale serve agora · Caddy + domínio na VPS depois)
        ▼
docker compose
 ├─ web      → arquivos estáticos do PWA (servidos pelo próprio api ou nginx leve)
 ├─ api      → FastAPI (REST + upload) · agendador de notificações embutido
 ├─ db       → PostgreSQL 16
 └─ volumes  → pgdata · uploads (anexos) · backups
        │
        ▼
OpenAI API  (texto/imagem/PDF → JSON estruturado validado)
Web Push    (servidores da Apple e do Google entregam as notificações)
```

### 5.1 Stack

| Camada | Escolha | Motivo |
|---|---|---|
| Front | React + Vite + TypeScript, `vite-plugin-pwa` (manifest + service worker), React Router, TanStack Query | Padrão de mercado, leve com cuidado; TS ajuda no aprendizado |
| Estilo | CSS com tokens (variáveis) ou Tailwind; **sem** biblioteca de componentes pesada | Galaxy A13 é aparelho de entrada |
| Gráficos | SVG próprio ou lib < 50 kB gzip | Leveza |
| API | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 + Alembic | Escolha do Matheus |
| Agendador | APScheduler dentro do processo `api` (fuso `America/Sao_Paulo`) | Um serviço a menos |
| Push | `pywebpush` com chaves VAPID | Funciona em iOS (PWA instalado) e Android |
| IA | SDK oficial `openai` (Python), saída estruturada por JSON Schema/Pydantic | Validação garantida |
| PDF | `pypdf`/`pdfplumber` para extrair texto de PDFs digitais; PDF escaneado ou imagem vai direto ao modelo com visão | Mais barato e preciso |
| Imagem | `Pillow` + `pillow-heif` (fotos HEIC do iPhone), redução para ~1600 px antes de enviar | Custo e velocidade |
| Testes | `pytest` + `httpx` (API), `vitest` (front), Playwright (E2E, skill `webapp-testing`) | — |
| Qualidade | `ruff` (lint+format), `mypy` (opcional), `eslint` + `tsc --noEmit` | — |
| Infra | Docker Desktop (Windows) agora; Docker + Caddy na VPS | Mesmo `compose` nos dois |

> Testes de API extras: o framework de Rest Assured do Matheus pode apontar para `/api` como gate adicional (opcional, Fase 5).

### 5.2 Estrutura do repositório

```
app-personal-finance/
├─ ORQUESTRACAO.md            ← este arquivo
├─ .planning/STATE.md         ← decisões e estado vivo (lead mantém)
├─ apps/
│  ├─ api/                    ← FastAPI (src/finance_api/…, tests/, alembic/)
│  └─ web/                    ← PWA (src/…, public/, tests/)
├─ e2e/                       ← Playwright (Python), viewports dos dois aparelhos
├─ infra/
│  ├─ docker-compose.yml
│  ├─ docker-compose.vps.yml  ← override com Caddy
│  ├─ seed/seed.yaml          ← carga inicial (seção 11)
│  └─ scripts/ (backup.sh, restore.sh, gen-vapid.py)
├─ docs/
│  ├─ api/openapi.yaml        ← contrato (gerado e congelado na Onda 0)
│  ├─ referencia/             ← planilha v2 (D13)
│  └─ deploy-pc.md · deploy-vps.md · instalar-no-celular.md
├─ Makefile (ou tasks.ps1)    ← comandos de verificação (seção 10)
├─ .env.example               ← nunca o .env real
└─ .agents/skills/…           ← alethe, find-skills e skills da seção 12
```

---

## 6. Funcionalidades em detalhe

### 6.1 Login e permissões
- PIN de 6 dígitos (D16), guardado com **argon2**. 5 tentativas erradas → bloqueio de 15 min.
- Sessão por aparelho: cookie `httpOnly` + `Secure` + `SameSite=Strict`, validade 30 dias, renovada no uso. Admin pode revogar sessões.
- Regra de escrita (D6/D12): o dono do registro altera/exclui; registros **Ambos** podem ser alterados/excluídos pelos dois; admin pode tudo.
- Leitura: os dois leem tudo.
- **Auditoria**: toda criação/edição/exclusão grava quem, quando, antes/depois.

### 6.2 Chat de lançamentos (tela inicial)
Fluxo:
1. Usuário envia texto, foto (câmera/galeria) ou PDF (até 10 MB). O anexo é salvo no volume `uploads`.
2. `api` prepara a entrada: PDF digital → texto extraído; PDF escaneado/imagem → imagem reduzida.
3. Chamada à OpenAI com **contexto mínimo**: data de hoje, quem enviou, lista de contas (nome, tipo, dono, últimos 4 dígitos se houver), categorias, regras de classificação. **Nunca** enviar PIN, tokens ou dados de outros sistemas.
4. Resposta validada contra o schema `ExtractionResult` (abaixo). Falha de validação → 1 nova tentativa; depois, mensagem amigável e formulário manual.
5. O chat mostra **cartões de proposta**: valor, data, tipo, conta, categoria, dono, descrição, confiança. Campos com baixa confiança aparecem destacados.
6. Ações por cartão: **Confirmar · Editar · Descartar**. Em lote (extratos): "Confirmar todos" após revisão.
7. Só ao confirmar o lançamento é gravado e os saldos mudam.

Regras de negócio (testadas em U5):
- **Transferência interna**: origem e destino são contas cadastradas no app (ex.: Sonia → Matheus) → grava como `transfer` com duas pernas; não entra em receitas/despesas.
- **Duplicidade**: hash de (conta, data ±1 dia, valor, descrição normalizada). Possível duplicata → cartão marcado "já existe?" com link para o lançamento existente.
- **Cartão de crédito**: compra no cartão aumenta a fatura (não mexe no saldo bancário); pagamento de fatura = transferência conta → cartão.
- **Gasto novo no cartão** que não é recorrente cadastrado → aviso "regra do plano".
- **Conta a pagar**: se o lançamento parece o pagamento de uma conta a pagar aberta (valor e descrição próximos), o cartão sugere "marcar Luz CEMIG de nov como paga".

Erros da OpenAI:
- `429` com código `project_spend_limit_exceeded` ou `organization_spend_limit_exceeded` → **não repetir**; mensagem "O limite mensal da IA foi atingido. Lance pelo formulário." e aviso ao admin.
- Outros `429`/`5xx` → até 2 tentativas com espera crescente; depois, mesma saída manual.
- Modelo e parâmetros vêm de variáveis de ambiente (`OPENAI_MODEL`, etc.) e são editáveis no admin. A escolha do modelo (com visão e saída estruturada, o mais barato que passar nos testes de extração) é feita em U5 consultando a documentação e os preços atuais (skill `openai-docs`).

Schema de saída (resumo; versão final em `apps/api/src/finance_api/ai/schemas.py`):
```json
{
  "transactions": [{
    "kind": "income | expense | transfer",
    "amount_cents": 4590,
    "date": "2026-11-12",
    "description": "Supermercado BH",
    "account_hint": "Nubank Ruth",
    "to_account_hint": null,
    "category_hint": "Mercado",
    "owner_hint": "RUTH | MATHEUS | AMBOS",
    "is_credit_card": false,
    "confidence": 0.0,
    "notes": "por que classificou assim"
  }],
  "document_type": "receipt | statement | invoice | free_text | other",
  "warnings": ["..."]
}
```

### 6.3 Aba Geral
- **Saldos**: cartão por conta (agrupado por dono), total por dono e total do casal; faturas abertas dos cartões; saldo devedor das dívidas.
- **Contas a pagar**: próximos 15 dias e vencidas, com dono, valor e "marcar como paga".
- **Movimentações**: lista com filtros (dono, conta, categoria, período, tipo); busca por texto.
- Botões de editar/excluir só aparecem para quem pode (D6/D12).

### 6.4 Metas
Tipos:
- **Acumular valor** (ex.: reserva de emergência), com aportes vinculados a uma conta ou manuais.
- **Quitar dívida** (ex.: empréstimo), progresso pelo saldo devedor.
- **Receita por período** (ex.: Uber diário com níveis Piso R$ 100 · Meta R$ 130 · Desafio R$ 160, a partir da categoria "Uber").
- **Teto de gasto por categoria** (ex.: iFood/mês).
Cada meta tem dono (Ruth / Matheus / Ambos), valor-alvo, prazo e progresso automático.

### 6.5 Notificações
- Interface `NotificationChannel` com implementações `WebPushChannel` (ativa) e `WhatsAppChannel` (stub desativado, para o número dedicado futuro).
- **Diário 21h** (D8), para os dois, todo dia: "Hora de enviar as movimentações de hoje" + lista das contas de quem recebe; toque abre o chat.
- **Vencimentos** (D9/D15): 2 dias antes e no dia, às 9h; toque abre a conta a pagar.
- iPhone: push só funciona com o app **instalado na tela inicial**, e a permissão é pedida após um toque do usuário (botão "Ativar notificações" na tela de configurações).
- Assinaturas de push inválidas (410/404) são removidas automaticamente.

### 6.6 Painel admin (só Matheus)
- Usuários: trocar/resetar PIN, revogar sessões.
- Contas, categorias e contas fixas (todas, inclusive as da Ruth, para suporte).
- Notificações: horário do diário, antecedência dos vencimentos, envio de teste, aparelhos inscritos.
- IA: modelo, versão do prompt, histórico de chamadas (data, tipo de documento, tokens informados pela API, custo estimado), contagem de falhas e de 429 por limite.
- Auditoria: quem alterou o quê.
- Sistema: saúde dos serviços, último backup, exportação CSV, download do backup.

### 6.7 Plano (projeção e amortização — ênfase baixa)
- Porta as fórmulas da aba Projeção da planilha v2: fluxo mês a mês, amortização automática do excedente acima da reserva de R$ 2.000, mês de quitação e juros economizados (tabela Price, 3,45% a.m.).
- Usa como entrada as receitas/despesas reais confirmadas + premissas editáveis (Uber mensal esperado, valor e mês da amortização etc.).
- **Amortização pendente (D14)**: a tela compara "amortizar agora" com "sem amortizar" e mostra quanto de juros cada mês de espera custa.
- **Teste de referência**: com as premissas da planilha (Uber R$ 2.600/mês, amortização inicial R$ 8.000), o resultado deve bater com a planilha (quitação em abr/27, ~R$ 1.430 de juros) dentro de R$ 1 de tolerância. O teste usa as premissas da planilha, não o estado real.

---

## 7. Modelo de dados (resumo)

Dinheiro sempre em **centavos (inteiro)**. Datas no fuso `America/Sao_Paulo`.

| Tabela | Campos principais |
|---|---|
| `users` | id, name, role (`admin`/`member`), pin_hash, failed_attempts, locked_until |
| `sessions` | id, user_id, device_label, expires_at, revoked_at |
| `accounts` | id, owner (`RUTH`/`MATHEUS`/`AMBOS`), created_by, name, type (`checking`/`savings`/`cash`/`meal_voucher`/`credit_card`/`loan`), institution, last4, initial_balance_cents, initial_balance_date, closing_day, due_day, active |
| `categories` | id, name, kind (`income`/`expense`), parent_id, is_recurring_card_allowed |
| `transactions` | id, kind, amount_cents, date, description, account_id, to_account_id, category_id, owner, created_by, status (`confirmed`), source (`chat`/`manual`/`import`), attachment_id, ai_extraction_id, dedupe_hash, bill_instance_id |
| `ai_extractions` | id, user_id, attachment_id, input_kind, model, prompt_version, raw_output_json, usage_tokens, est_cost_cents, status, error_code |
| `drafts` | id, ai_extraction_id, payload_json, status (`pending`/`confirmed`/`discarded`), resolved_by, resolved_at |
| `attachments` | id, user_id, path, mime, size, sha256 |
| `recurring_bills` | id, owner, name, amount_cents, due_day, start_month, end_month, account_id, category_id, payment_method |
| `bill_instances` | id, recurring_bill_id, month, due_date, amount_cents, status (`open`/`paid`), paid_transaction_id |
| `debts` | id, owner, name, principal_cents, monthly_rate, installments, installment_cents, start_date, current_balance_cents |
| `goals` | id, owner, type, name, target_cents, period, levels_json, due_date, linked_account_id, linked_category_id, active |
| `goal_entries` | id, goal_id, amount_cents, date, transaction_id |
| `push_subscriptions` | id, user_id, endpoint, keys_json, device_label, created_at, last_ok_at |
| `notification_log` | id, user_id, channel, type, sent_at, status, error |
| `settings` | key, value_json (horários, antecedência, modelo IA, reserva mínima…) |
| `audit_log` | id, user_id, entity, entity_id, action, before_json, after_json, at |

Saldo atual de uma conta = `initial_balance_cents` + lançamentos confirmados a partir de `initial_balance_date` (calculado na consulta; sem campo de saldo gravado para não divergir).

---

## 8. Orquestração com a alethe

### 8.1 Pré-requisitos (lead verifica na Onda 0)
1. Planilha v2 presente em `docs/referencia/` (P10). `git init` na pasta, `.gitignore` (inclui `.env`, `uploads/`, `backups/`, `node_modules/`, `.venv/`). A alethe usa **worktrees** para escritores paralelos.
2. Python ≥ 3.9 no Windows para rodar `orchestrate.py` (`py --version`). Sem Python, seguir `references/manual.md`.
3. Conferir os atalhos `.claude/skills/alethe` e `.claude/skills/find-skills` (no Windows eles precisam abrir; se não abrirem, reinstalar com `npx skills add` ou copiar a pasta de `.agents/skills/`).
4. `py .agents/skills/alethe/scripts/orchestrate.py doctor` → se não houver política salva, onboarding (`references/onboarding.md`) com os provedores **claude** e **agy**, salvando só o que o Matheus aprovar.
5. `usage --refresh-claude` e `usage --refresh-agy` antes da primeira onda.
6. Segredos (`OPENAI_API_KEY`, VAPID, PINs iniciais) só no `.env` local. **Nunca** em planos, briefs, argumentos ou logs.
7. Planos JSON ficam **fora do repositório** (ex.: `%USERPROFILE%\.alethe-plans\financas\`), como a skill exige.

### 8.2 Papéis e modelos (playbook `complete`, conforme o print)

| Papel | Padrão | Alternativas automáticas |
|---|---|---|
| planner (lead) | Claude Opus · high | — |
| do it yourself (tarefa estreita) | Claude Opus · high | — |
| scout ×4 (leitura/pesquisa) | Claude Haiku · low | Claude baixo → `gemini-3.8-flash-low` (agy) |
| builder | Claude Sonnet · medium | tarefa profunda + Opus > 50% → Sonnet · high; Claude baixo → `gemini-3.8-flash-high` |
| reviewer | `gemini-3.8-flash-high` (agy) | Antigravity baixo → Claude Sonnet · medium |
| fixer | Claude Opus · high | orçamento > 80% → Sonnet · high; Claude baixo → `gemini-4-argon-high` |

O reviewer roda em outro provedor que o builder, o que dá uma revisão independente.
Ajustes por unidade (seção 9): unidades marcadas **[risco]** (dinheiro, autenticação, IA) **nunca** usam tier barato e passam por revisão em duas etapas.

### 8.3 Modo e regras permanentes
```
orchestrate.py mode on --goal balanced --care careful \
  --rule "Nunca gravar segredos em planos, briefs ou logs" \
  --rule "Dinheiro sempre em centavos inteiros" \
  --rule "IA nunca grava lançamento sem confirmação do usuário" \
  --rule "Workers não fazem commit; o lead commita por fase com ok do Matheus"
```
`careful`: ler antes de escrever, isolar todo escritor, revisar todo diff antes de integrar, perguntar antes de algo difícil de desfazer.

### 8.4 Ciclo de cada onda
1. `playbook --pick` → escolher o playbook da fase (tabela 9) e dizer em uma linha por quê.
2. `scaffold <strategy> --workers N` → preencher `title`, `playbook`, `phase`, `why`, briefs e `budget`.
3. `validate` → `models` → `dry-run` (estimativa, `quotaForecast`). Mostrar ao Matheus: playbook, nº de workers, provedores/modelos, estimativa e cota. **Esperar o ok.**
4. `new "<título>" --playbook <id> --why "<linha>" --lead claude:opus` (uma vez por orquestração) → `run <plano> --in current --detach` → `wait --timeout 540` até `done`.
5. Ler `state.json`, `outcome.json`, `result.md`, `diff.patch` (nunca logs brutos sem motivo).
6. Gate da fase (seção 10). Falhou → `fix` uma vez por unidade e recheca.
7. Integrar, `mark <worker> used|partial|discarded`, atualizar `.planning/STATE.md`.
8. `report` ao fim da fase; mostrar a saída ao Matheus; commit da fase (D19).

### 8.5 Orçamento sugerido (ajustável)
- Por onda: `budget` no plano com `maxCalls` = nº de workers × 2 e `maxWallSeconds` = 3600.
- Orquestração inteira: `budget --max-calls 60` (revisar após a Onda 1 com os números reais do `report`).
- Paralelismo: no máximo **3 workers simultâneos** (acima de 2, a alethe pergunta antes).

---

## 9. Fases, ondas e unidades

Legenda: **[risco]** = revisão em duas etapas (spec-validator + quality-reviewer) e tier ≥ standard.

| Onda | Playbook | Unidades | Quem |
|---|---|---|---|
| 0 Fundação | `plan-execute` (plano pelo lead) | U0 | lead + 1 builder |
| 1 Base | `parallel-worktrees` | U1, U2, U3, U4 | builders isolados |
| 2 IA | `plan-execute` | U5 → U6 | builder (U5 forte) |
| 3 Telas e avisos | `parallel-worktrees` | U7, U8, U9 | builders isolados |
| 4 Plano | `cascade` | U10 | builder barato→standard com teste de referência |
| 5 Fechamento | `review-gate` + `scout-then-build` | U11, U12, U13 | reviewers + builder |

### U0 — Fundação (lead decide, builder executa)
- **Dono**: raiz, `infra/`, `docs/api/openapi.yaml`, esqueletos de `apps/api` e `apps/web`, `Makefile`/`tasks.ps1`, `.planning/STATE.md`.
- **Faz**: estrutura de pastas; `docker-compose.yml` (api, db, volumes); FastAPI com `/api/health`; Alembic com o schema da seção 7; PWA mínimo com manifest e service worker; **contrato OpenAPI** de todos os endpoints da v1 (congelado ao fim da onda); `make check` funcionando; `.env.example`; gerador de chaves VAPID.
- **Pronto quando**: `docker compose up` sobe; `/api/health` = 200; migração aplica do zero; `make check` verde; PWA abre em `https://<máquina>.<tailnet>.ts.net` no celular.

### U1 — Autenticação e usuários [risco]
- **Dono**: `apps/api/src/finance_api/auth/**`, `users/**`, `audit/**` + testes.
- **Faz**: PIN (argon2), bloqueio, sessões por aparelho, dependências de permissão (dono/Ambos/admin), log de auditoria genérico.
- **Pronto quando**: testes cobrem login certo/errado, bloqueio, expiração, revogação, "Ruth não edita registro do Matheus", "admin edita tudo", auditoria gravada.

### U2 — Contas, categorias e lançamentos [risco]
- **Dono**: `apps/api/src/finance_api/{accounts,categories,transactions}/**` + testes.
- **Faz**: CRUD com permissões de U1 (via interface definida em U0); saldo calculado; transferências com duas pernas; regras de cartão de crédito; hash de duplicidade; filtros da aba Geral; exportação CSV.
- **Pronto quando**: testes de saldo (inicial + entradas − saídas ± transferências), compra no cartão não altera conta corrente, pagamento de fatura, duplicata detectada, filtros por dono.

### U3 — Casca do PWA
- **Dono**: `apps/web/src/{app,shell,auth,ui}/**`, `apps/web/public/**`.
- **Faz**: login por PIN (teclado numérico grande), navegação inferior (Chat · Geral · Metas · Plano · Mais), tokens de design, estados de carregando/erro/vazio, cliente da API gerado a partir do OpenAPI, tela "Como instalar no celular", área segura do iPhone (notch).
- **Pronto quando**: Lighthouse PWA instalável; bundle inicial ≤ 200 kB gzip; funciona em 414×896 (iPhone 11) e 412×915 (A13) sem rolagem horizontal; `tsc` e `eslint` verdes.

### U4 — Contas a pagar, dívidas e metas (API)
- **Dono**: `apps/api/src/finance_api/{bills,debts,goals}/**` + testes.
- **Faz**: recorrentes → instâncias mensais; marcar como paga (vincula lançamento); dívidas com saldo devedor; metas dos 4 tipos com progresso automático.
- **Pronto quando**: testes de geração mensal (início/fim), vencidas, progresso de cada tipo de meta, níveis do Uber diário.

### U5 — Ingestão por IA (API) [risco] (tier forte)
- **Dono**: `apps/api/src/finance_api/{ai,ingest,attachments}/**` + testes + `apps/api/tests/fixtures/ai/**`.
- **Faz**: upload (limites, HEIC, redução), extração de texto de PDF, chamada OpenAI com saída estruturada, rascunhos, confirmação/descartar/editar, regras da seção 6.2 (interna, duplicidade, cartão, sugestão de conta paga), tratamento de 429 por limite, registro em `ai_extractions`.
- **Testes**: a OpenAI é **simulada** nos testes (respostas gravadas em fixtures); um teste opcional `-m live` usa a API real com 3 documentos de exemplo **sem dados reais** (comprovante, extrato curto, texto livre).
- **Pronto quando**: nenhum caminho grava lançamento sem confirmação; 429 de limite não repete; fixtures cobrem os 5 tipos de documento; transferência Sonia → Matheus vira `transfer`.

### U6 — Tela de chat
- **Dono**: `apps/web/src/features/chat/**`.
- **Faz**: caixa de mensagem, anexo (câmera, galeria, PDF), progresso do envio, cartões de proposta com Confirmar/Editar/Descartar e "Confirmar todos", destaque de baixa confiança, avisos de duplicata e de regra do plano, formulário manual.
- **Pronto quando**: E2E (com API simulada) cobre texto, imagem e PDF; editar antes de confirmar funciona; nada grava sem toque em Confirmar.

### U7 — Notificações
- **Dono**: `apps/api/src/finance_api/notifications/**`, `apps/web/src/features/notifications/**`, trecho de push do service worker.
- **Faz**: `NotificationChannel` + `WebPushChannel` + `WhatsAppChannel` (stub), agendador 21h e vencimentos, inscrição/remoção de aparelhos, botão "Ativar notificações", envio de teste no admin.
- **Pronto quando**: teste do agendador com relógio simulado (21h em `America/Sao_Paulo`); assinatura inválida removida; push de teste chega nos dois aparelhos reais (checagem manual registrada no STATE).

### U8 — Telas Geral e Metas
- **Dono**: `apps/web/src/features/{overview,goals,accounts,bills}/**`.
- **Faz**: saldos, contas a pagar, movimentações com filtros, cadastro das próprias contas com saldo inicial, metas com progresso; botões de edição conforme permissão.
- **Pronto quando**: E2E com dois usuários: Ruth cria conta e lançamento; Matheus vê e não consegue editar; filtros Ruth/Matheus/Ambos corretos.

### U9 — Painel admin
- **Dono**: `apps/api/src/finance_api/admin/**`, `apps/web/src/features/admin/**`.
- **Faz**: seção 6.6.
- **Pronto quando**: rotas admin retornam 403 para a Ruth; todas as ações gravam auditoria; exportação CSV abre no Excel com acentos corretos.

### U10 — Plano: projeção e amortização
- **Dono**: `apps/api/src/finance_api/plan/**`, `apps/web/src/features/plan/**`.
- **Faz**: seção 6.7.
- **Pronto quando**: teste de referência contra a planilha v2 passa (tolerância R$ 1).

### U11 — E2E nos tamanhos dos aparelhos
- Skill `webapp-testing` (Playwright em Python), viewports 414×896 e 412×915, fluxos: login, chat→confirmar, Geral, metas, admin bloqueado para Ruth.

### U12 — Revisão adversarial de segurança e dinheiro
- Reviewer em sessão nova, só leitura: autenticação, permissões, upload, injeção de prompt em documentos (texto do PDF não pode virar instrução), cálculo de saldo, transferências, perda de dados.
- Termina com `VERDICT: PASS | FAIL | NOT_PROVEN` e `NOT CHECKED:`.

### U13 — Deploy e operação
- `docs/deploy-pc.md` (Docker Desktop + Tailscale serve no Windows, iniciar com o Windows), `docs/deploy-vps.md` (Docker + Caddy + domínio, migração com `pg_dump`), `docs/instalar-no-celular.md` (iPhone e Android, ativar notificações), backup diário com retenção de 14 dias.
- Aviso na doc: ao trocar de `*.ts.net` para o domínio próprio, o PWA precisa ser **reinstalado** nos celulares e as notificações reativadas (a origem muda). Os dados ficam no servidor.

---

## 10. Gates e comandos de verificação

| Comando | O que roda |
|---|---|
| `make check` (ou `./tasks.ps1 check`) | `ruff check` + `ruff format --check` + `pytest` (api) + `eslint` + `tsc --noEmit` + `vitest` + `vite build` |
| `make e2e` | sobe o compose de teste e roda `e2e/` (Playwright, dois viewports) |
| `make ai-live` | testes `-m live` da IA (opcional, gasta API) |
| `make size` | confere o limite do bundle (≤ 200 kB gzip inicial) |

Gate de toda unidade: `make check` verde **e** diff conferido pelo reviewer contra a seção da unidade.
Gate das unidades [risco]: + spec-validator e quality-reviewer com `VERDICT: PASS`.
Gate final (v1 pronta): `make check` + `make e2e` + U12 `PASS` + push testado nos dois aparelhos + backup/restore testado.

Ao revisar um worker: ler primeiro as mudanças nos testes (teste enfraquecido para passar = falha).

---

## 11. Carga inicial (a confirmar na revisão; vem da planilha v2)

Usuários: Matheus (admin), Ruth (member). Contas bancárias e saldos **não** vêm daqui: cada um cadastra na interface (D5).

Contas fixas (todas com dono **Ambos**, D20):

| Conta | Dono | Valor | Pagamento |
|---|---|---|---|
| Parcela do apartamento | Ambos | R$ 750,00 | Boleto/Pix |
| Financiamento do carro (Banco Volkswagen) | Ambos | R$ 1.667,03 | Boleto |
| Condomínio | Ambos | R$ 180,00 | Boleto |
| Luz (CEMIG) | Ambos | R$ 200,00 | Pix |
| Internet Vero | Ambos | R$ 89,90 | Boleto |
| Vero (mãe) | Ambos | R$ 30,00 | Pix |
| Mesa igreja | Ambos | R$ 50,00 | Pix |
| Guia MEI (DAS) | Ambos | R$ 90,00 | Boleto |
| Amil (odontológico) | Ambos | R$ 57,80 | Boleto |
| Seguro Loovi | Ambos | R$ 284,23 | Cartão (recorrente permitido) |
| Academia (Contorno do Corpo) | Ambos | R$ 129,90 | Cartão (recorrente permitido) |
| Cartão de Todos | Ambos | R$ 33,40 | Cartão (recorrente permitido) |
| Assinaturas (Apple, Google One, Spotify, Claude) | Ambos | R$ 172,02 | Cartão (recorrente permitido) |
| Hostinger | Ambos | R$ 64,99 | Cartão Reginaldo (confirmar se é mensal) |

Dívidas:

| Dívida | Dono | Dados |
|---|---|---|
| Empréstimo | Ambos | R$ 22.000, 3,45% a.m., 24× de ~R$ 1.362,82 (Price); **sem amortização feita** (D14); saldo devedor informado no primeiro uso |
| Cartão Santander (Reginaldo) | Ambos | ~R$ 4.900 em parcelas sem juros |
| Cartão Sicredi (Midea) | Ambos | ~R$ 3.025 em parcelas sem juros (estimativa) |

Metas iniciais (propostas): quitar o empréstimo (Ambos); reserva mínima de R$ 2.000 (Ambos); plano de saúde de R$ 580/mês a partir de mai/27 (Ambos); Uber diário 100/130/160 (Matheus).

Categorias iniciais: Salário, Uber/99, IPTV, Vale-alimentação · Moradia, Carro, Combustível, Mercado, Farmácia, Alimentação fora, Contas da casa, Assinaturas, Saúde, Igreja, MEI/Impostos, Dívidas/Empréstimo, Transferência interna, Outros.

---

## 12. Skills (levantamento com find-skills em 12/11/2026)

O `npx skills find` não respondeu deste ambiente; a busca foi feita no skills.sh. Priorizar fontes oficiais e com muitas instalações. **Revisar o SKILL.md de cada uma antes de instalar.**

| Skill | Uso no projeto | Fonte / instalações | Instalação |
|---|---|---|---|
| `webapp-testing` | E2E com Playwright em Python (U3, U6, U8, U11) | anthropics/skills, oficial, 100K+ | `npx skills add anthropics/skills --skill webapp-testing` |
| `frontend-design` | Direção visual das telas (U3, U8) | anthropics/skills, oficial, 1,1M | `npx skills add anthropics/skills --skill frontend-design` |
| `vercel-react-best-practices` | Padrões React e desempenho (U3, U6, U8) | vercel-labs/agent-skills, ~890K | `npx skills add vercel-labs/agent-skills --skill vercel-react-best-practices` |
| `web-design-guidelines` | Acessibilidade e usabilidade no celular | vercel-labs/agent-skills, ~850K | `npx skills add vercel-labs/agent-skills --skill web-design-guidelines` |
| `fastapi` | Padrões atuais do FastAPI (U0–U5) | publicador `fastapi` no skills.sh, ~15K | confirmar o repositório em skills.sh/fastapi antes de instalar |
| `supabase-postgres-best-practices` | Índices, tipos e consultas no Postgres (U0, U2) | supabase/agent-skills, ~480K | `npx skills add supabase/agent-skills --skill supabase-postgres-best-practices` |
| `openai-docs` | Escolha do modelo, saída estruturada, entrada de PDF/imagem (U5) | openai/skills, oficial | `npx skills add openai/skills --skill openai-docs` |
| `test-driven-development`, `verification-before-completion`, `systematic-debugging` | Disciplina dos builders e do fixer | obra/superpowers, ~270–330K | `npx skills add obra/superpowers --skill <nome>` |
| PWA (opcional) | Service worker, manifest, peculiaridades do iOS (U3, U7) | alinaqi/claude-bootstrap `pwa-development` (~2,6K, auditoria "MEDIUM") | só após revisar o conteúdo |

Evitar: `lackeyjb/playwright-skill` e cópias (auditoria de segurança do skills.sh marcou risco crítico).
Briefs apontam para o caminho do SKILL.md relevante, para que workers do Claude e do agy usem a mesma referência.

---

## 13. Riscos e cuidados

| Risco | Cuidado |
|---|---|
| PC desligado = app fora do ar | Documentar; priorizar a migração para a VPS assim que estiver pronta. |
| iPhone sem push | Só funciona com o app instalado na tela inicial e permissão dada após um toque. Tela de instalação explica. |
| Troca de origem na migração | PWA reinstalado e push reativado (U13). |
| IA erra valor ou conta | Confirmação obrigatória + destaque de baixa confiança + edição antes de gravar. |
| Instruções escondidas em PDFs | Texto do documento entra só como dado; o prompt de sistema proíbe seguir instruções do conteúdo (U12 testa). |
| Dados financeiros na OpenAI | Mandar só o necessário; nunca PIN, tokens ou números completos de cartão (mascarar para os 4 últimos). |
| Limite da OpenAI atingido | Hard limit do projeto devolve 429 com código de limite; o app não repete e oferece o formulário. |
| Perda de dados | Backup diário + teste de restauração no gate final. |
| Aparelho fraco (A13) | Limite de bundle, imagens reduzidas no envio, nada de bibliotecas pesadas. |

---

## 14. Histórico

| Data | Versão | Mudança |
|---|---|---|
| 12/11/2026 | v0.1 | Rascunho inicial com as decisões D1–D11 e as pendências P1–P8. |
| 12/11/2026 | v0.2 | P1–P8 respondidas → D12–D19. Nome "Finanças"; Tailscale privado; amortização tratada como pendente no Plano. Abertas: P9 (donos da carga inicial) e P10 (copiar a planilha). |
| 12/11/2026 | v0.3 | P9 → D20: todas as contas fixas como Ambos. P10 confirmada pelo Matheus (copiar a planilha); lead confere a presença do arquivo na Onda 0. |
