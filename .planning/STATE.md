# Estado vivo — Finanças

> Mantido pelo lead. Workers leem; não editam (exceto quando o brief mandar).

## Fase atual
Onda 0 commitada (`1abd9ee`). Onda 1 (U1–U4) commitada (`32de996`).
**Onda 2: U5 + U6 integradas e revisadas** (sem commit): `tasks.ps1 check` verde (271 testes api + 39 web), `size` 73,8 kB gzip. Próxima: commit da Onda 2 (com ok do Matheus).

## Onde paramos (13/11/2026) — retomar daqui
1. **U6 feita** (builder Claude Sonnet high, worktree isolado; integrada só `features/chat/**`), revisada no agy e corrigida pelo lead (ver seção U6 abaixo). Worktree removido.
2. Orquestração alethe atual: `20261112-203856-onda-2-ia-u5-u6` (se `status` não achar: `orchestrate.py use <pasta>`; `list` mostra).
3. Falta: **commit da Onda 2 (U5 + U6) com ok do Matheus** (fora `.claude/settings.json`), `report`.
4. Sem commit no checkout agora: tudo da U5 (`ai/`, `attachments/`, `ingest/`, testes, fixtures),
   `main.py`, `core/config.py`, `.env.example`, `.planning/U5-ingestao.md`, `.planning/U6-chat.md`,
   `features/chat/**`, `ChatTab.tsx`, `bills/router.py` + `tests/bills/test_api.py`, este arquivo.
5. Pendências do Matheus: Galaxy A13 (Tailscale + PWA); confirmar `due_day`/`start_date` da carga
   inicial; conferir as decisões "permissão de lançamento" e "empréstimo num lugar só"; pôr
   `OPENAI_API_KEY` no `.env` para o lead escolher o modelo e rodar `./tasks.ps1 ai-live`.

## U6 — Tela de chat (13/11/2026)
- Builder Claude Sonnet high seguindo `.planning/U6-chat.md` (8 min, US$ 1,29); Docker estava desligado no worker, o lead rodou o `check` completo.
- Revisão (agy gemini flash, gerador `geradores/gen_onda2_u6_review.py`): spec FAIL (cabeçalhos de aviso não lidos; testes faltando), qualidade FAIL → corrigido pelo lead:
  - high: "Marcar como paga" aparecia com cartão editado para receita/transferência → só para despesa; **API**: `POST /bill-instances/{id}/pay` com `transaction_id` que não é despesa → 422.
  - high: 409 num cartão editado mostrava a edição local como "Confirmado" → limpa a edição.
  - high: 409 no "Confirmar todos" deixava o item ainda pendente sem aviso → aviso "nada foi gravado".
  - high→low: barra travava em "Enviando…" durante a leitura da IA → `xhr.upload.onload` = 100%.
  - spec: cabeçalhos `X-Possible-Duplicate-Of` / `X-Plan-Rule-Warning` agora aparecem após confirmar e no lançamento manual.
  - medium/low: anexo recusado limpa o anterior; lote liga transação também pela descrição; `payBill` invalida `["transactions"]`.
- Aceitos/adiados: sem botão de cancelar envio (timeout 180 s); caixa de mensagem no meio da tela vazia e `label` de arquivo sem estilo desabilitado → U11 (Playwright, 360–412 px); aparência em celular real não conferida.
- Decisões do builder (spec: conformes): editados no "Confirmar todos" vão um a um; lote→transação por posição + formato; rascunho sem conta fica fora do lote; 409 relê `GET /ingest/{id}`; 401 via `setMe(null)`. Chaves de cache: `["transactions"]`, `["overview"]`, `["accounts"]`, `["bill-instances"]` — U8 deve usar os mesmos prefixos.

## U5 — Ingestão por IA (12/11/2026)
- Builder Claude Opus high seguindo `.planning/U5-ingestao.md`; integrada pelo lead.
- Revisão (agy): spec **PASS**; qualidade FAIL → corrigido pelo lead:
  - high: imagem de PDF escaneado que não decodifica derrubava o envio (500) → imagem pulada.
  - high: 429 `insufficient_quota` (saldo pré-pago zerado) era repetido → tratado como limite (não repete, mensagem de limite).
  - medium: temporário de upload com nome único (envios simultâneos do mesmo arquivo).
  - low: item extraído com valor/data fora dos limites vira aviso em `IngestResult.warnings` (guardado em `ai_extractions.raw_output_json.server_warnings`).
- Decisões da U5 (handoff): saída inválida da IA → 503 `ai_unavailable` com `error_code="ai_invalid_output"`; confirm/discard: 404 → 403 (só quem enviou ou admin) → 409; despesa entre duas contas do app vira `transfer`; transferência com só um lado no app vira despesa/receita com aviso; `GET /attachments/{id}` devolve o tipo detectado + `nosniff`; `/drafts/{id}/confirm` devolve os mesmos cabeçalhos de duplicata/regra do plano que `POST /transactions`; imagens com `detail: "high"`; `est_cost_cents` nulo até escolher o modelo.
- Pendente: **escolher o modelo da OpenAI** (docs e preços atuais) e rodar `./tasks.ps1 ai-live` com a chave no `.env`; HEIC de iPhone real; aviso ao admin quando o limite da IA estoura → U7/U9.
- Para a U6: confirmar **não** marca conta a pagar como paga; o cartão oferece "marcar como paga" via `POST /bill-instances/{id}/pay` quando `suggested_bill_instance_id` vier preenchido.

## Revisão da Onda 1 (12/11/2026, agy gemini-3.8-flash-high, só leitura)
- U1 spec: tudo implementado; NOT_PROVEN só porque o CLI `finance_api.auth.bootstrap` não tem teste. U1 qualidade: PASS (5 achados low, ver abaixo).
- U2 spec: FAIL só por divergências de contrato (corrigidas) e testes faltando (401, paginação de categorias — adicionados).
- U2 qualidade: FAIL → corrigido pelo lead:
  - **critical**: lançar/transferir/editar/excluir em conta de outro dono passava (só o `owner` do lançamento era checado). Agora `ensure_can_move` exige escrita no dono da **conta de origem** (criação, edição — conta antiga e nova — e exclusão). Destino de transferência não exige (só recebe).
  - **high**: `/overview` ignorava a tabela `debts` no saldo devedor. Agora soma `debts.current_balance_cents` + contas `loan` negativas.
  - medium: CSV não neutralizava fórmula precedida de espaços (e `|`, `%`). low: nome só com espaços virava "" (agora 422).
- Contrato: cookie `SameSite=Strict`; `403` em `DELETE /auth/sessions/{id}`; `export.csv` sem default de `limit` (exporta tudo).

## Base da Onda 1 (lead, congelada)
- `main.py` liga os routers de todos os módulos (`MODULE_ROUTERS`); unidades só editam o `router.py` do próprio módulo.
- `core/audit.py`: `record_audit(db, *, user_id, entity, entity_id, action, before, after)` na mesma sessão, antes do commit.
- `tests/conftest.py`: Postgres real (`./tasks.ps1 testdb`, 127.0.0.1:55432), banco por checkout, rollback por teste; fixtures `db`, `users`, `app`, `client_as`.
- `tasks.ps1`: `testdb`, `setup` (uv sync + npm install), `web <script>`; `check` sobe o testdb.
- Front: `openapi-typescript` (gerador, peer TS 5) roda com TS 6 via `overrides` no package.json; tipos em `apps/web/src/api/schema.d.ts` (`./tasks.ps1 web gen:api`).

## Pontos abertos da Onda 1 (dos handoffs)
- U1: troca de PIN fica no admin (U9: `/admin/users/{id}/reset-pin`); admin listar sessões alheias → U9 (`/admin/users/{id}/sessions`).
- U1 (low, da revisão): cookie só é renovado em `/auth/me` (o PWA chama no boot); `expires_at` é gravado a cada requisição (renovar no máximo 1×/dia); revogar sessão alheia dá 403 e inexistente 404 (enumera IDs; aceito, só 2 usuários); CLI `bootstrap` sem teste.
- U2: nomes de parâmetro de rota no código (`{account_id}`, `{category_id}`, `{tx_id}`) diferem do contrato (`{id}`); a URL é a mesma — aceito.
- U2: empréstimo deve ficar num lugar só (dívida em `debts` **ou** conta `loan`), senão conta duas vezes no `/overview`. Conta `loan` com saldo inicial positivo some dos totais → U6 deve orientar saldo negativo.
- U1: `ensure_initial_users` existe (`python -m finance_api.auth.bootstrap`), ainda **não** é chamado no startup.
- U2: avisos de duplicata e de "regra do plano" vão em **cabeçalhos HTTP** (o contrato não tem campo) → U6 precisa lê-los, ou o contrato ganha campo.
- U2/U4: excluir lançamento que pagou uma conta não reabre a `bill_instance` → decidir dono (U4).
- U4: seed com `due_day`/`start_date` provisórios (planilha não tem vencimentos) → Matheus confirma; meta "quitar empréstimo" liga à dívida pelo nome; caminho do `seed.yaml` dentro da imagem Docker a ajustar.
- U3: `App.tsx` antigo virou re-export de `app/App` (pode ser removido); rolagem horizontal em 412 px verificada só por construção (U11 confere com Playwright).

## Ambiente (12/11/2026)
- Windows 11, Python 3.14 do sistema + `uv` (o projeto fixa Python 3.12 via `uv`), Node 24 / npm 11, git 2.56.
- Docker 29.9 e Tailscale 1.104 instalados. Máquina na tailnet: `optimousprime`.
- **Sem `make`** → comandos ficam em `tasks.ps1` (seção 10 do ORQUESTRACAO.md permite).
- `.env` local criado pelo lead a partir do `.env.example` (senha do Postgres aleatória; fora do git). OpenAI, VAPID e PINs ainda vazios.

## Gate da Onda 0 (12/11/2026)
- [x] `./tasks.ps1 check` verde (ruff, ruff format, pytest 26, eslint, tsc, vitest 2, vite build).
- [x] `./tasks.ps1 size`: 67 kB gzip (limite 200 kB).
- [x] Migração em Postgres 16 real: `upgrade head`, `downgrade base`, `upgrade head` e `alembic check` sem diferenças.
- [x] `./tasks.ps1 up`: db saudável, api aplica `0001_initial` e sobe; `/api/health` = 200; `/` e `/manifest.webmanifest` = 200.
- [x] `tailscale serve --bg 8000` ativo (tailnet only): `https://optimousprime.tail6cabb8.ts.net/api/health` = 200 via HTTPS.
- [x] PWA aberto e instalado no iPhone 11 via Tailscale (checagem manual do Matheus, 12/11/2026).
- [ ] Galaxy A13: falta instalar o Tailscale e abrir o PWA (não bloqueia a Onda 1).

## Decisões de construção
| Data | Decisão |
|---|---|
| 12/11/2026 | Modelos SQLAlchemy de **todas** as tabelas da seção 7 ficam em `apps/api/src/finance_api/db/models.py` (dono: U0, congelado). Ondas seguintes não alteram tabelas sem passar pelo lead (nova migração). |
| 12/11/2026 | Interface de permissão e usuário atual em `apps/api/src/finance_api/core/` (`deps.py`, `permissions.py`); U1 implementa por trás dela, U2/U4 só importam. |
| 12/11/2026 | Contrato OpenAPI escrito à mão (design-first) em `docs/api/openapi.yaml`, prefixo `/api`; **congelado**. Mudança depois disso = pedido ao lead. |
| 12/11/2026 | Comandos de verificação em `tasks.ps1` (`check`, `e2e`, `ai-live`, `size`, `up`, `down`, `vapid`). |
| 12/11/2026 | API publicada só em `127.0.0.1:8000` no compose; o acesso externo é pelo `tailscale serve` (nunca porta aberta na LAN). |
| 12/11/2026 | `docker compose` à mão precisa de `--env-file .env` (o `tasks.ps1` já passa). Override VPS usa `!reset` (Compose ≥ 2.24). |
| 12/11/2026 | Versões do front: vite 8, TypeScript 6, vitest 5, vite-plugin-pwa 2, eslint 10. Aviso `inlineDynamicImports` obsoleto no build do SW (inofensivo). |
| 12/11/2026 | Workers da alethe rodam com `--setting-sources user`: só valem as permissões de `~/.claude/settings.json` (hoje: `uv` e `tasks.ps1`). `npm` direto ainda pede permissão. |
| 12/11/2026 | Revisores `agy` (headless) só leem o que `~/.gemini/antigravity-cli/settings.json` libera: hoje `read_file` do repositório. Sem shell; o brief do builder vai embutido no prompt. |
| 12/11/2026 | Permissão de lançamento (D6): além do `owner` do lançamento, quem não é admin precisa poder escrever no dono da **conta de origem**; receber numa conta alheia (destino de transferência) é livre. |

## Pendências abertas
- Galaxy A13: app Tailscale + abrir o PWA (iPhone já ok).
- U7: confirmar que o `sw.js` gerado (clássico) aceita o handler de push.
- ~~`usage --refresh-agy` falhou~~ **resolvido em 13/11/2026**: o agy deixa um processo filho com o cwd na pasta temporária por um instante (WinError 32 ao apagar). `probe_agy_quota` em `.agents/skills/alethe/scripts/orchestrate.py` agora usa `mkdtemp` + limpeza tolerante (5 tentativas). Leitura do agy funcionando.
