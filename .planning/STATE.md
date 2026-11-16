# Estado vivo — Finanças

> Mantido pelo lead. Workers leem; não editam (exceto quando o brief mandar).

## Fase atual
Onda 0 commitada (`1abd9ee`). Onda 1 (U1–U4) commitada (`32de996`).
Onda 2 (U5–U6) commitada (`af48d2f`).
Onda 3 (U7–U9) commitada (`6189eda`).
Onda 4 (U10) commitada (`0a4fed5`).
**Onda 5: U11 + U12 + U13 integradas, corrigidas e verificadas** (sem commit): `tasks.ps1 check` verde (425 testes api + 130 web), `tasks.ps1 e2e` 26/26 (414×896 e 412×915), backup/restore testados no Docker. A pilha real (`tasks.ps1 up`) já roda este código. Próxima: commit da Onda 5 (com ok do Matheus) e, por último, a carga de dados.

## Falta fazer (consolidado em 14/11/2026 — Matheus: "faremos os ajustes depois")
Do Matheus:
1. Testar o chat com envio real.
2. Conferir D6 (permissão de lançamento) e "empréstimo num lugar só" (só a dívida em `debts`; sem conta `loan`).
3. `start_date` real do empréstimo (provisório 01/11/2026).
4. Vencimento real das 14 contas fixas (todas no dia 10; dá para editar na tela).
5. Cada um cadastra contas bancárias e movimentações no app (D5).

Pequenas, opcionais: índice único em `bill_instances.paid_transaction_id` (migração); `SpaStaticFiles` com `//api/...`; conta fixa aceita categoria de receita pela API; conta fixa com início no mês seguinte só gera a instância na próxima leitura; busca por prefixo; PIN trivial; desligar `/api/docs` antes da VPS; copiar backups para fora do PC.

Próximo trabalho (14/11/2026): redesenho da interface, referência despezzas.com (`docs/referencia/visual/`).

## Redesenho da interface (desde 14/11/2026)
- Spec: `docs/superpowers/specs/2026-11-14-redesign-interface-design.md`. Plano: `docs/superpowers/plans/2026-11-14-redesign-interface.md` (ondas R0 → R1 U14–U15 → R2 U16–U23 → R3 U24–U25).
- Branch `redesenho` (a partir de `ba0a4f2`). Ledger: `.superpowers/sdd/2026-11-14-redesign-interface/progress.md` (fora do git). Alethe: `20261114-165311-redesenho-r0-base`.
- **R0 feita pelo lead (14/11), sem commit**: tokens/cores/fonte Inter (offline no PWA), kit `apps/web/src/ui/` (Button, IconButton, Card, StatCard, Chip, MonthSwitcher, Skeleton, Sheet, ListItem/Avatar, SparkleIcon, Money + olho global), casca responsiva (`shell/`: barra flutuante com ✦ < 1024px; menu lateral + cabeçalho ≥ 1024px), rotas novas (`/`, `/transacoes`, `/lancar`, `/relatorios`, `/mais`, `/preferencias`, `/contas-fixas`, `/contas`, `/metas`, `/plano`, `/admin/:secao`; `/geral` e `/mais/admin` redirecionam), contrato `GET /reports/month` + `features/reports/api.ts` (`useMonthReport`). Telas ainda provisórias (reaproveitam as seções antigas). `check` verde (api 431, web 182, build) e e2e 26/26.
- R0 commitada (`9e7afd0`).
- **R1 (14/11), commit `07b437b`**: alethe `20261114-174413-redesenho-r1-dados-e-graficos`, geradores `~/.alethe-plans/financas/geradores/gen_redesign_r1*.py`. U14 `GET /reports/month` (`apps/api/src/finance_api/reports/`, 17 testes) e U15 gráficos (`apps/web/src/ui/charts/`: DonutChart, LineChart, BarChart, ChartTooltip, CATEGORY_PALETTE) por Sonnet high (US$ 0,92); revisão agy FAIL nos dois → corrigido pelo lead (share_bp com total 0; ano 0000 → 422; contas fixas de meses futuros até 12 geradas no GET; centro da rosca acessível; série de 1 ponto com marcador; cor do tooltip; `useMediaQuery` movido para `ui/`). Aceitos: imports privados de `transactions/router` e `overview/router` no relatório. `check` verde (api 448, web 196) e e2e 26/26.
- Lição: revisor agy headless não pode rodar shell — o brief tem de proibir shell e listar os arquivos exatos.
- **R2 (14/11), commit `44cd073`**: alethe `20261114-220446-redesenho-r2-telas`, geradores `gen_redesign_r2*.py`. 8 telas (U16 Dashboard, U17 Transações, U18 Lançar, U19 Contas fixas/Contas, U20 Metas/Plano, U21 Relatórios, U22 Admin por seção, U23 Login/Mais/Preferências com tema) por Sonnet high, 4 por vez (US$ 9,57, ~20 min). Revisão agy: FAIL em U18/U20/U22 → corrigido pelo lead (relatório invalidado após gravar; olho no rascunho e nas metas; Ruth em todas as rotas admin; tabela do Plano em 360px). Lead removeu `features/overview/`, seções antigas e `shell/tabs/`. Timeouts de teste 5s/15s (jsdom sob carga). Gate: api 448, web 330, build ok, e2e 26/26. Pendências menores no ledger (`minor (deferred)`), incl. subtrações herdadas da v1 que pedem campos na API.
- **R3 (14/11), em andamento**: Claude a 86% da janela de 5h → por decisão do Matheus, só a revisão de acessibilidade (agy) rodou: FAIL, achados no ledger `.superpowers/sdd/2026-11-14-redesign-interface/` (contraste de warning/income/borda no claro, foco em Sheet e no hero, valores fora de `Money`, estouros em 360px).
- **R3 (16/11), em andamento**: alethe `20261116-162350-redesenho-r3-fechamento`, geradores `gen_redesign_r3.py` e `gen_redesign_r3_money.py`. Onda 01 (US$ 5,80, 15 min): a11y CSS e a11y TSX (Sonnet high) corrigiram todos os achados das duas revisões (tokens claros warning `#92400e`/income `#116932`, `--color-border-strong` em controles, foco no hero, 360px, alvos 48px, focus trap + `inert` no Sheet, valores via `Money`, teto estourado em texto, foco em Metas/Admin, PinPad/status anunciados); U24 (Sonnet high) escreveu e2e com 3 aparelhos (414×896, 412×915, desktop 1280×800) + `small-360` só para layout; revisão de dinheiro (Opus): **PASS** (1 medium de API, 1 medium aceito, lows).
  Lead na integração: **gráficos tinham largura 0 no navegador desde a R1** (`max-width: 100%` no wrapper do Recharts; jsdom não pega) → removido; tabela oculta dos gráficos alargava 360px → `visually-hidden` num div em `ui/charts/shared.tsx`; skeleton do saldo 176→198px (conteúdo pulava 22px); testes de skeleton com `assert_layout(idle=False)`. Gate: `check` (api 448, web 407, build) e e2e **78/78**.
  Aceito sem mudança: fatia "Outras" do Dashboard somada no front (desvio ≤ 0,1 pp no percentual; centavos exatos) → pede campo `others_*` na API; comparativo do mês anterior no início do mês (melhoria futura: acumulado até o mesmo dia).
  Lição: workers Claude não leem `~/.alethe-plans` (fora dos diretórios permitidos) — achados precisam ir no brief.
- Onda 02 (`money-fix`, Sonnet high, checkout principal): "Contas pagas" soma o lançamento vinculado (fallback: valor da instância); Dashboard no fuso de SP; olho ligado não pinta negativo; teto estourado por centavos; "Saldo líquido de X" em Contas. Lead: "Novembro De 2026" → `::first-letter`. Gate final: `check` (api 449, web 413, build) e e2e **78/78**. Capturas: 96 PNG (16 rotas × 3 aparelhos × 2 temas) em `docs/referencia/visual/resultado/` (14 MB, fora do git).
  Restos low (não feitos): "Total de X" ainda no hero do Dashboard (mesmo dado de `/overview`); `chat/dates.ts` `todayIso` no fuso do aparelho (saldo inicial, metas, proposta).
- Próximo: Matheus confere as capturas → revisão final do branch (opcional) → ok e commit da R3.

## Onde paramos (13/11/2026) — retomar daqui
1. **Onda 5 feita**: U11 (E2E) e U13 (deploy) por Sonnet high; U12 por Claude Opus (segurança) e agy (dinheiro), ambos FAIL → corrigido pelo lead (ver seção "Onda 5"). Worktrees removidos.
2. Orquestração alethe atual: `20261113-140835-onda-5-fechamento-u11u13`. Gerador: `geradores/gen_onda5.py`.
3. Onda 5 commitada (`7324b7e`). **Seed da planilha carregado no banco real (13/11/2026)**, com backup antes (`financas-20261113-150004.dump`): 18 categorias, 14 contas fixas (todas com vencimento dia 10, decisão do Matheus: ele ajusta depois), 3 dívidas, 4 metas. Empréstimo com `start_date` provisório 01/11/2026. O agendador gerou sozinho as contas de dezembro.
   **Decisão do Matheus: o uso começa em dez/26** → as 14 contas fixas passaram a ter `start_month` 2026-12-01 e as instâncias de novembro foram removidas (backup `financas-20261113-151050.dump`, auditoria gravada). Dezembro: 14 contas vencendo em 10/12.
   **Tela de contas fixas** commitada (`cfa8625`). (Geral → "Contas fixas": listar, criar, editar vencimento/valor/conta bancária/categoria/dono, encerrar/reativar, excluir com 409 → Encerrar): builder Sonnet (US$ 1,00), revisão agy FAIL → lead corrigiu (mês corrente no fuso de SP; "Manter a conta atual" baseado no registro original; erro + "Cancelar" se contas/categorias não carregam na edição; marca "Começa em mm/aaaa"; o total mensal mantém as que começam depois, com rótulo explícito — decisão do lead, já que todas começam em dez/26). `check` 425 api + 154 web, e2e 26/26; já no ar. Orquestração `20261113-151331-tela-de-contas-fixas`, geradores `gen_contas_fixas.py` e `gen_contas_fixas_review.py`. Contas bancárias e movimentações: cada um cadastra no app (D5).
4. **Teste manual do push: PASSOU** (13/11/2026, Matheus, nos dois celulares; roteiro em `.planning/teste-push.md`). Usuários criados no banco do Docker com `auth.bootstrap`; seed ainda **não** carregado (banco sem categorias, contas fixas, dívidas e metas). **Decisão do Matheus (13/11): a carga da planilha e das contas/movimentações existentes fica para o final** (antes, confirmar `due_day` das contas fixas — todos em 10, provisório — e `start_date` do empréstimo; não há tela para editar conta fixa).
5. **Modelo da IA escolhido (13/11/2026): `gpt-6.1-terra`** (docs oficiais da OpenAI: texto+imagem, structured outputs, Responses API; "visual reasoning"; US$ 1,00 entrada / US$ 5,00 saída por 1M tokens). Alternativa 10× mais barata: `gpt-6-luna` (US$ 0,10 / 0,50), se o custo pesar. `./tasks.ps1 ai-live` 3/3 (foto, PDF, texto) e agora carrega o `.env` da raiz sozinho. App reiniciado com o modelo. **Custo estimado** (13/11): `ai/pricing.py` com preços oficiais em centavos de US$ por 1M tokens (fonte e data no arquivo; atualizar ao trocar de modelo), arredondado para cima; o painel admin mostra em US$ (sem conversão para reais).
   Pendências do Matheus: testar o chat com envio real; conferir as decisões "permissão de lançamento" (D6) e "empréstimo num lugar só" (a dívida "Empréstimo" já está em `debts`: não criar também conta `loan`); `start_date` real do empréstimo (provisório 01/11/2026).
   **Gate final (seção 10) FECHADO em 13/11/2026**: check + e2e verdes, push nos dois celulares, backup/restore testados, **re-revisão U12 PASS** (agy: segurança e dinheiro, as 7 correções confirmadas pelos dois). Custo estimado da IA no admin commitado (`ba0a4f2`).
   Lows da re-revisão (não corrigidos): sem índice único em `bill_instances.paid_transaction_id` (corrida improvável com 2 usuários; exige migração); `SpaStaticFiles` devolve o index para `//api/...` (só URL malformada); conta fixa aceita categoria de receita pela API (a tela já filtra); criar conta fixa com início no mês seguinte só gera a instância na próxima leitura.
   Outras pendências pequenas: busca de lançamentos por prefixo; PIN trivial aceito; desligar `/api/docs` antes da VPS; copiar backups para fora do PC.

## Onda 5 — Fechamento (13/11/2026)
- **Base do lead**: marcador pytest `e2e` (fora do `check`), `tasks.ps1 e2e` (testdb + build + Chromium + `pytest tests/e2e -m e2e`).
- **U11 E2E** (Sonnet high): Playwright em Python, app em processo (uvicorn em thread, banco `_e2e` próprio, IA falsa), 13 fluxos × 2 viewports: login, chat→confirmar, Geral (filtros e permissões), Metas, Plano (abr/2027), admin bloqueado para a Ruth, sem rolagem horizontal. Achou **bug**: F5/abrir direto `/geral` devolvia 404 JSON (sem fallback de SPA) → **corrigido** (`SpaStaticFiles` em `main.py`; `/api/*` e arquivos inexistentes continuam 404).
- **U13 deploy** (Sonnet high): serviço `backup` no compose (03:00 SP, recupera se o PC estava desligado, `.tmp` → renomeia, retenção 14 dias, nome `financas-AAAAMMDD-HHMMSS.dump`); `./tasks.ps1 backup [pasta]` (volume + cópia em `./backups`); `./tasks.ps1 restore <arquivo> -Confirmar [-SemSeguranca]` (backup de segurança, para a api, `pg_restore --single-transaction`, sobe a api; sem `-Confirmar` só explica); seed na imagem (`SEED_FILE=/app/seed/seed.yaml`); docs `deploy-pc.md`, `deploy-vps.md`, `instalar-no-celular.md`. **Verificado pelo lead**: compose válido, scripts em LF, serviço fez o backup do dia, backup manual com cópia no host, API/painel enxergam o backup, restore 2× (segunda com `--clean`) em banco descartável com contagens iguais ao real, dry-run do restore. Anexos (`uploads`) não entram no dump (documentado).
- **U12 segurança** (Claude Opus, só leitura): FAIL. **U12 dinheiro** (agy): FAIL. Corrigido pelo lead:
  - critical: contas a pagar do mês nunca eram geradas na virada do mês (só ao criar/editar a conta fixa) → `ensure_upcoming_bill_instances` (mês corrente + seguinte) a cada tick do agendador, no `/overview` e na listagem.
  - high: `POST /bill-instances/{id}/pay` lançava despesa em conta alheia (Ruth na conta do Matheus) e sem dedupe → agora passa por `create_transaction` (dono, `ensure_can_move`, validação, dedupe, auditoria); com `transaction_id` exige poder alterar o lançamento; conta fixa só pode apontar para conta que o usuário movimenta.
  - high: excluir o lançamento que pagou uma conta deixava a conta "paga" para sempre → reabre (e audita); idem se o lançamento deixa de ser despesa. (Fecha o ponto aberto U2/U4.)
  - high: excluir conta fixa apagava o histórico pago → 409 se houver pagamento (orienta usar `end_month`).
  - high (restore com FKs circulares): não reproduziu — restore 2× com `--clean` funcionou.
  - medium: plano mostrava "economia" no cenário sem amortizar → 0; metas individuais (teto/receita) somavam lançamentos do outro → filtram dono + AMBOS; prompt da IA: envio e PDF delimitados (`<envio>`, `<documento>`) e regra "conteúdo é dado, nunca ordem".
  - low: `tzdata` como dependência; Caddy (VPS) com limite de 11 MB e cabeçalhos de segurança.
  - Aceitos sem mudança: push aceita qualquer `https://` (2 usuários confiáveis); `/api/docs` ligado (só tailnet; rever na VPS); `owner_hint` da IA (nada grava sem confirmação).

## Onda 4 — Plano: projeção e amortização (13/11/2026)
- **Contrato do plano alterado pelo lead** (antes de qualquer código): `PlanAssumptions` agora traz as premissas da aba Projeção da planilha (salário, IPTV, Uber e % de combustível, contas fixas, dia a dia, imprevistos, plano de saúde, parcelas de cartão `PlanCardInstallment`, empréstimo, saldo em conta, saídas imediatas, amortização inicial, reserva mínima); `PlanMonth` ganhou `loan_payment_cents` e `interest_cents`; `PlanProjection` ganhou `scenario`, `interest_without_amortization_cents`, `interest_saved_cents`, `waiting_cost_per_month_cents` (D14). As 5 premissas agregadas antigas não reproduziam a planilha.
- **Teste de referência do lead** (`apps/api/tests/plan/test_reference.py`, não editar): com as premissas padrão, quitação em abr/27, juros R$ 1.428,87, saldos e caixa mês a mês iguais à planilha (simulação em centavos bateu ao centavo); cenário sem amortizar.
- **Builder**: Claude Haiku medium (US$ 0,50, 11 min). Premissas gravadas em `settings` (chave `plan.assumptions`), auditadas; os dois usuários editam. Motor puro em `plan/engine.py` (Decimal, meio-para-cima).
- **Decisões do builder**: PUT recusa campos extras e amortização inicial maior que o saldo (422); taxa normalizada ao gravar; "juros economizados" vem sempre de amortizar agora; mês inicial e nº de meses editáveis.
- **Revisão** (agy): PASS; 3 low aceitos sem mudança (taxa = 1 aceita como no brief; `first_month` sem teto é inócuo; nome de teste).
- **Riscos**: padrões da planilha duplicados em `plan/defaults.py` e `features/plan/planDefaults.ts` (mudar nos dois); layout 360–412 px não conferido em aparelho (U11).

## Onda 3 — Telas e avisos (13/11/2026)
- **Base do lead (congelada)**: `core/app_settings.py` (chaves `notify.daily_time` 21:00, `notify.bill_time` 09:00, `notify.bill_days_before` 2; PUT do admin substitui, ausente volta ao padrão); `notifications/lifecycle.py` (startup/shutdown/scheduler_ok) chamado no lifespan de `main.py` (`create_app(start_scheduler=False)` nos testes); `BACKUP_DIR`; rota `/mais/admin` com `AdminRoute`; aba Mais com `NotificationsCard` e link do admin; placeholders das telas.
- **Builders** (Sonnet high, ~10–15 min cada, US$ 5,0 no total): U7 notificações, U8 Geral/Metas/contas, U9 admin.
- **Revisão** (agy gemini flash, 1 reviewer por unidade): U8 PASS; U7 e U9 FAIL → corrigido pelo lead:
  - U7 high: `notificationclick` podia abrir URL de outra origem → só a própria origem.
  - U7 high: desistência após 3 falhas contava linhas por aparelho → conta tentativas (ticks).
  - U7 medium: permissão liberada nas configurações do aparelho não era relida → relê ao voltar ao app.
  - U9 high: backup mais recente pegava qualquer arquivo (inclusive link simbólico) → só `financas-AAAAMMDD-HHMMSS.dump` regular, sem seguir link; `stat` uma vez só (sem 500 em corrida).
  - U9 medium: PIN novo digitado duas vezes na tela.
  - Recusado: "PUT parcial apaga configurações" (é a semântica de substituição do contrato; o front manda as 3 chaves).
  - Adiados (low): troca de chaves VAPID exige desativar/reativar no aparelho; contadores de falha/429 da IA valem só para a página exibida; PIN trivial (000000) aceito.
- **Decisões dos builders**: U7 rejeita endpoint de push que não seja `https://` (422, fora do contrato); `/admin/notifications/test` com usuário inexistente → `{sent: 0}`; um push por conta a pagar e por usuário. U8 edita lançamento com PATCH; aportes manuais só em meta de acumular sem conta vinculada; conta `loan` com saldo positivo é recusada no formulário; "Minhas contas" lista só as que o usuário pode alterar (sem excluir, só inativar). U9: reset do próprio PIN mantém a sessão atual; revogar as próprias sessões derruba também a atual (a tela avisa).
- **Ponto aberto (U2)**: a busca por texto em `/transactions` é por prefixo da descrição, não por trecho → avaliar na U12/ajuste.
- **Teste manual do push (Matheus)**: roteiro completo em `.planning/teste-push.md` (inclui pré-requisitos: chaves VAPID, PINs iniciais, `bootstrap` dos usuários e seed opcional).

## Onda 3 — Testes:
Notificações chegaram, porém a seção de contas está vazia.

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
- ~~U2/U4: excluir lançamento que pagou uma conta não reabre a `bill_instance`~~ resolvido na Onda 5.
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
