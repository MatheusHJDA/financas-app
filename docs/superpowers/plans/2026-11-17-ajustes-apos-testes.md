# Ajustes após os testes — plano de execução

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lembrete da meta Uber, filtro em Contas fixas, tela de Categorias e puxar para atualizar.

**Architecture:** Mudanças pequenas e independentes sobre o que existe: o aviso diário (`notifications/service.py`)
ganha uma linha da meta; o chat aceita `/lancar?meta=<id>`; Contas fixas filtra no cliente; Categorias é uma tela nova
sobre a API `/categories`; o gesto de atualizar fica na casca (`shell/`).

**Tech Stack:** FastAPI, SQLAlchemy, pytest; React + TS, TanStack Query, vitest; Playwright (e2e em pytest).

**Spec:** `docs/superpowers/specs/2026-11-17-ajustes-apos-testes-design.md`

## Global Constraints

- pt-BR em toda a interface; valores em `Money` (olho de ocultar); alvos ≥ 48px; ok em 360px; temas claro/escuro.
- Dinheiro em centavos inteiros; datas de hoje no fuso de São Paulo (`today_sp()` na API; `todayIso` do chat no web).
- Mudanças gravadas passam por `ensure_can_write` e `record_audit` (como o resto da API).
- Gate por tarefa: testes da tarefa + `uv run ruff check . && uv run ruff format --check .` (api) e/ou
  `npm run lint && npm run typecheck` (web). Gate final: `./tasks.ps1 check` e `./tasks.ps1 e2e`.

## Review Focus

1. Aviso diário sem meta diária (ou meta de outro dono): corpo e url iguais aos de hoje (Task 1).
2. `/lancar?meta=` com id inexistente, de meta não `income_period` ou sem categoria: abre o chat normal, sem erro (Task 1).
3. Filtro que zera a lista: mensagem "Nenhuma conta com esses filtros." e botão Limpar (Task 2).
4. Excluir categoria usada por meta: 409, não 500 (Task 3).
5. Puxar para atualizar não dispara com um Sheet aberto nem quando a página não está no topo (Task 4).

---

### Task 1: Lembrete da meta Uber no aviso diário

**Files:**
- Modify: `apps/api/src/finance_api/notifications/service.py` (`_run_daily`, `_daily_body`)
- Modify: `apps/web/src/features/chat/ChatPage.tsx`, `apps/web/src/features/chat/ManualEntry.tsx`
- Test: `apps/api/tests/notifications/test_tick.py`, `apps/web/src/features/chat/ChatPage.test.tsx`

**Interfaces:**
- Produces: payload diário `{"title": "Finanças", "body": ..., "url": "/lancar?meta=<id>"}` quando há meta;
  `ManualEntry` prop `initial?: { kind: "income" | "expense"; categoryId: number; owner: Owner; date: string }`.

- [ ] **Step 1: Testes que falham (API, `test_tick.py`)**
  - `test_daily_inclui_meta_diaria_do_usuario`: meta `income_period` daily "Uber diário", dono MATHEUS, alvo 13000,
    categoria de receita; receita de 11000 hoje na categoria; tick às 21:00 → payload do Matheus tem
    `"Uber diário hoje: R$ 110,00 de R$ 130,00 — quanto rodou?"` no corpo e `url == f"/lancar?meta={goal.id}"`;
    payload da Ruth sem essa linha e `url == "/"`.
  - `test_daily_sem_meta_fica_igual`: sem metas → corpo e url como antes.
  - Meta AMBOS aparece para os dois (usar a regra `_visible`).
- [ ] **Step 2:** `cd apps/api; uv run pytest tests/notifications/test_tick.py -q` → FAIL.
- [ ] **Step 3:** Implementar com `goals.service.compute_progress(db, goal, today)` (current/target) e `format_brl`;
  só metas `type == "income_period"` e `period == "daily"`; a linha vai depois do texto atual, separada por ". ".
- [ ] **Step 4: Testes que falham (web, `ChatPage.test.tsx`)**: renderizar `/lancar?meta=4` com a meta 4
  (`GET /goals/4` → income_period, linked_category_id 2, owner MATHEUS) → o Sheet "Lançar à mão" abre com Tipo
  Receita, Categoria "Uber/99", Data = hoje, Valor vazio e focado; `?meta=999` (404) → chat normal, sem Sheet e sem
  alerta.
- [ ] **Step 5:** Implementar (ler `useSearchParams`, buscar `GET /goals/{id}`, abrir `setManual` com `initial`;
  limpar o parâmetro da URL depois de abrir). Rodar `npx vitest run src/features/chat` → PASS; lint/typecheck.
- [ ] **Step 6:** Commit `feat: lembrete da meta diária no aviso das 21h`.

### Task 2: Filtro em Contas fixas

**Files:**
- Create: `apps/web/src/features/bills/BillFilters.tsx`, `apps/web/src/features/bills/billFilters.ts`
- Modify: `apps/web/src/features/bills/FixedBillsPage.tsx`, `PayableBills.tsx`, `bills.css`
- Test: `apps/web/src/features/bills/billFilters.test.ts`, `FixedBillsPage.test.tsx`

**Interfaces:**
- Produces: `type BillStatusFilter = "all" | "open" | "paid" | "overdue"`;
  `filterBills(bills, instances, { status, categoryId }, today) -> { bills, instances }` (puro).

- [ ] **Step 1: Testes que falham**: `billFilters.test.ts` — "A pagar" mantém só contas com instância do mês
  `open` e não vencida; "Vencidas" só `open` com `due_date < hoje`; "Pagas" só `paid`; categoria filtra as duas
  listas; `prepaid` conta como paga. `FixedBillsPage.test.tsx` — escolher Situação "Pagas" esconde as abertas nas
  duas colunas; categoria sem contas → "Nenhuma conta com esses filtros." e "Limpar filtros" volta a tudo.
- [ ] **Step 2:** `npx vitest run src/features/bills` → FAIL.
- [ ] **Step 3:** Implementar. Controles: grupo de `Chip` (Todas, A pagar, Pagas, Vencidas) com `aria-pressed` e um
  `<select>` "Categoria" (Todas + categorias de despesa usadas pelas contas). Lembrar a escolha em `localStorage`
  (try/catch).
- [ ] **Step 4:** Mesmo comando → PASS; lint/typecheck.
- [ ] **Step 5:** Commit `feat(web): filtro em Contas fixas`.

### Task 3: Tela de Categorias

**Files:**
- Create: `apps/web/src/features/categories/{CategoriesPage.tsx,CategorySheet.tsx,api.ts,categories.css,testing.tsx,CategoriesPage.test.tsx}`
- Modify: `apps/web/src/app/App.tsx` (rota `categorias`), `apps/web/src/shell/nav.ts` (Mais e menu lateral, título),
  `apps/api/src/finance_api/categories/router.py` (uso por meta)
- Test: `apps/api/tests/categories/test_categories.py`, `CategoriesPage.test.tsx`

**Interfaces:**
- Consumes: `GET/POST /categories`, `PATCH/DELETE /categories/{id}` (existentes).
- Produces: rota `/categorias`; invalida `["categories"]` e as chaves que leem categorias (verificar com grep:
  chat `useChatData`, `accounts/queries.ts`, relatórios).

- [ ] **Step 1: Teste API que falha**: `test_delete_categoria_usada_por_meta_409` (meta com `linked_category_id`).
- [ ] **Step 2:** `uv run pytest tests/categories -q` → FAIL; incluir `Goal.linked_category_id` na checagem; → PASS.
- [ ] **Step 3: Testes web que falham**: lista "Receitas" e "Despesas" com as categorias; "Nova categoria" (nome +
  tipo) faz POST e aparece; "Renomear" faz PATCH só com `name`; "Excluir" pede confirmação e faz DELETE; 409 mostra
  "Essa categoria está em uso em lançamentos, contas fixas ou metas e não pode ser excluída."; nome vazio ou > 60
  caracteres mostra erro sem chamar a API (verificar o limite real em `categories/schemas`); Ruth também edita.
- [ ] **Step 4:** Implementar no padrão de `features/goals` / `features/bills` (Sheet do kit para criar/renomear).
- [ ] **Step 5:** `npx vitest run src/features/categories` → PASS; lint/typecheck; `uv run ruff ...`.
- [ ] **Step 6:** Commit `feat: tela de categorias`.

### Task 4: Puxar para atualizar

**Files:**
- Create: `apps/web/src/shell/usePullToRefresh.ts`, `apps/web/src/shell/PullIndicator.tsx`
- Modify: `apps/web/src/shell/Shell.tsx`, `apps/web/src/shell/shell.css`
- Test: `apps/web/src/shell/__tests__/usePullToRefresh.test.tsx`; e2e `apps/api/tests/e2e/test_e2e_redesign.py`

**Interfaces:**
- Produces: `usePullToRefresh({ enabled: boolean, onRefresh: () => Promise<void>, threshold = 72 })` →
  `{ distance: number, refreshing: boolean }`; `onRefresh` = `queryClient.invalidateQueries()` +
  `navigator.serviceWorker?.getRegistration().then(r => r?.update())`.

- [ ] **Step 1: Testes que falham** (eventos touch sintéticos): puxar 100px com `scrollY == 0` chama `onRefresh` uma
  vez e mostra "Atualizando…" (`role="status"`); puxar 40px não chama; com `scrollY > 0` não chama; com um
  `[role="dialog"]` aberto não chama; `enabled=false` (≥ 1024px) não registra listeners.
- [ ] **Step 2:** `npx vitest run src/shell` → FAIL.
- [ ] **Step 3:** Implementar com listeners passivos em `touchstart/touchmove/touchend` no `window`; resistência
  (distância/2, teto 120px); indicador fixo no topo abaixo do safe-area; CSS `overscroll-behavior-y: contain` no
  `body` só no celular, para não brigar com o gesto nativo do Android.
- [ ] **Step 4:** Mesmo comando → PASS; lint/typecheck.
- [ ] **Step 5:** e2e (só nos celulares, `has_touch`): no Início, simular o gesto com `page.touchscreen`/CDP ou
  disparar `TouchEvent` via `dispatchEvent` e conferir que uma nova chamada `GET /api/overview` acontece.
- [ ] **Step 6:** Commit `feat(web): puxar para atualizar no celular`.

### Task 5 (lead): investigar "Sem categoria" da IA e fechar
- [ ] Conferir em `ai/context.py` se as categorias vão no contexto e o que a IA devolveu na extração da "Compra de
  créditos" (tabela `ai_extractions`); se for limitação do texto (ambíguo), registrar e não mudar.
- [ ] `./tasks.ps1 check`, `./tasks.ps1 e2e`, backup, `up`, atualizar STATE.
