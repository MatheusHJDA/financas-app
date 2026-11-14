# Redesenho da interface — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Execução escolhida pelo Matheus: alethe** (ondas R0–R3, workers CLI distribuídos). Workers não fazem commit; o lead
> integra e commita cada onda só com o ok do Matheus, sem `.claude/settings.json`.

**Goal:** Dar ao app a cara do Despezzas: kit visual novo, navegação com ícones e ✦ central, Skeleton Screen, Dashboard com
gráficos, Relatórios e painel com menu lateral no computador, sem perder nenhuma função.

**Architecture:** Evolução do front atual (CSS puro + tokens) com um kit em `apps/web/src/ui/`, ícones `lucide-react` e
gráficos Recharts. Uma casca responsiva (barra flutuante < 1024px, menu lateral ≥ 1024px) envolve as mesmas telas.
Um endpoint novo `GET /reports/month` alimenta os cartões do mês e os gráficos.

**Tech Stack:** React 18, Vite, react-router 7, TanStack Query, openapi-fetch, Vitest + Testing Library; FastAPI +
SQLAlchemy + pytest; Playwright (Python) para e2e.

**Spec:** `docs/superpowers/specs/2026-11-14-redesign-interface-design.md`

## Global Constraints
- Dinheiro só em centavos inteiros; somas e agregações vêm da API. O front só formata (`formatCents` de
  `apps/web/src/features/chat/money.ts`, reexportado por `ui/money.tsx`).
- Sem rolagem horizontal em 360–414px; alvos de toque ≥ 48px; contraste AA em claro e escuro.
- Fonte `@fontsource-variable/inter` embutida (PWA offline, nada de CDN).
- Dependências novas permitidas: `lucide-react`, `recharts`, `@fontsource-variable/inter`. Nenhuma outra sem o lead.
- Sem marca, logo ou nome do Despezzas; sem logo do Gemini. `SparkleIcon` é desenho próprio.
- Breakpoint único do layout: `1024px` (`--bp-desktop`); mobile-first.
- Skeleton em todo carregamento de tela/seção; spinner só em ações curtas.
- `prefers-reduced-motion`: sem animação de shimmer/transição.
- Seletores de teste por papel/nome acessível (como os e2e atuais); nada de `data-testid` novo sem necessidade.
- `./tasks.ps1 check` e `./tasks.ps1 e2e` verdes ao fim de cada onda.
- Contrato em `docs/api/openapi.yaml` primeiro; front regenera tipos com `npm run gen:api` (em `apps/web`).
- Lançamento manual: só Receita/Despesa/Transferência; sem Único/Recorrente/Parcelado.

## Review Focus
1. **Mês sem dados / usuário novo** (Ruth em dez/26 sem lançamentos): Dashboard e Relatórios mostram zeros e estados vazios
   com convite para lançar, nunca gráfico quebrado ou `NaN`. → testes em U14 (API) e U16/U21 (tela).
2. **Valores negativos e grandes** (saldo negativo, R$ 1.234.567,89): `Money` com sinal e sem estourar o cartão em 360px.
   → teste em R0-T2 (`Money`) e `assert_layout` no e2e R3.
3. **Virada de mês no fuso de SP** (lançamento 31/12 23:30 SP): cai em dezembro no relatório. → teste em U14.
4. **Ruth não vê Administração** em nenhum layout, nem por URL direta `/admin/*`. → e2e em R0-T3 e U22.
5. **Olho ocultando valores**: oculta em todo `Money` (inclusive gráficos/tooltip), persiste ao recarregar, funciona se
   o localStorage lançar erro. → testes em R0-T2 e U15.

---

## Mapa de arquivos
```
apps/web/src/styles/tokens.css            (reescrito: cores, raios, sombras, fonte, --bp-desktop)
apps/web/src/styles/base.css              (reescrito: base + utilitários)
apps/web/src/ui/                          kit (R0) — um arquivo por componente + ui.css
apps/web/src/ui/charts/                   gráficos (U15)
apps/web/src/shell/                       casca: Shell.tsx, BottomBar.tsx, Sidebar.tsx, nav.ts, Header.tsx
apps/web/src/app/App.tsx                  rotas novas + redirecionamentos
apps/web/src/features/dashboard/          U16 (novo)
apps/web/src/features/transactions/       U17 (novo, extrai de overview/TransactionsSection)
apps/web/src/features/chat/               U18
apps/web/src/features/bills|accounts/     U19
apps/web/src/features/goals|plan/         U20
apps/web/src/features/reports/            U21 (novo) + api client do relatório
apps/web/src/features/admin/              U22
apps/web/src/auth/ + features/settings/   U23 (login, Mais, Preferências)
apps/api/src/finance_api/reports/         U14 (novo: router.py, service.py, schemas.py)
apps/api/tests/reports/test_reports.py    U14
apps/api/tests/e2e/                       R0-T3 (navegação), R3 (fluxos novos + desktop)
```

## Rotas (fixadas na R0)
| Rota | Tela | Menu celular | Menu lateral |
|---|---|---|---|
| `/` | Dashboard | Início | Controle › Dashboard |
| `/transacoes` | Transações | Transações | Controle › Transações |
| `/lancar` | Lançar (chat + manual) | ✦ central | IA › Lançar com IA |
| `/relatorios` | Relatórios | Relatórios | Planejamento › Relatórios |
| `/mais` | Mais (lista) | Mais | — |
| `/contas-fixas` | Contas fixas | Mais | Controle › Contas fixas |
| `/contas` | Contas | Mais | Controle › Contas |
| `/metas` | Metas | Mais | Planejamento › Metas |
| `/plano` | Plano | Mais | Planejamento › Plano |
| `/preferencias` | Notificações pessoais, instalar, tema | Mais | rodapé › Preferências |
| `/admin` → `/admin/usuarios` | | Mais › Administração | Administração |
| `/admin/{usuarios,configuracoes,avisos,ia,auditoria,sistema}` | seções admin | | Administração › … |
| `/geral` → `/`, `/mais/admin` → `/admin/usuarios` | redirecionamentos | | |

Nome acessível das navegações: celular `navigation "Principal"`; computador `navigation "Menu lateral"`.

---

## Onda R0 — Base (lead, sequencial, checkout principal)

### Task R0-T1: Tokens, fonte, dependências e CSS base

**Files:**
- Modify: `apps/web/package.json` (deps `lucide-react`, `recharts`, `@fontsource-variable/inter`)
- Modify: `apps/web/src/styles/tokens.css`, `apps/web/src/styles/base.css`, `apps/web/src/main.tsx` (import da fonte)

**Interfaces — Produces (tokens CSS usados por todos):**
`--color-bg --color-surface --color-surface-2 --color-text --color-muted --color-border --color-primary
--color-on-primary --color-income --color-expense --color-info --color-warning --color-danger --color-ok
--tone-income-bg --tone-expense-bg --tone-info-bg --tone-warning-bg --radius-sm(10px) --radius(16px) --radius-lg(24px)
--radius-pill --shadow-sm --shadow-md --font("Inter Variable", system-ui…) --sidebar-w(248px) --bp-desktop(1024px)`
mais os espaços/tamanhos atuais (mantidos). Valores claros/escuros conforme a seção "Linguagem visual" do spec.

- [ ] **Step 1:** `npm i lucide-react recharts @fontsource-variable/inter` em `apps/web`; importar a fonte em `main.tsx`.
- [ ] **Step 2:** reescrever `tokens.css` (claro + `@media (prefers-color-scheme: dark)` + `:root[data-theme=dark|light]`
  para o alternador de tema) e `base.css` (body com `--color-bg`, números `tabular-nums`, foco visível, reduced-motion).
- [ ] **Step 3:** `./tasks.ps1 check` → verde (só visual; nenhum teste deve quebrar).

### Task R0-T2: Kit de componentes `ui/`

**Files:**
- Create: `apps/web/src/ui/{Button,IconButton,Card,StatCard,Chip,MonthSwitcher,Skeleton,Sheet,ListItem,SparkleIcon,money}.tsx`, `ui/ui.css`, `ui/index.ts`
- Modify: `apps/web/src/ui/States.tsx` (restilizar; `LoadingState` continua existindo para ações curtas)
- Create: `apps/web/src/ui/__tests__/kit.test.tsx`, `apps/web/src/dev/KitPage.tsx` (rota `/dev/kit` só com `import.meta.env.DEV`)

**Interfaces — Produces (exportados de `ui/index.ts`):**
```ts
type Tone = "income" | "expense" | "info" | "warning" | "neutral";
Button(props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary"|"secondary"|"ghost"|"danger"; icon?: LucideIcon; block?: boolean })
IconButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string })   // aria-label = label
Card(props: { title?: string; icon?: LucideIcon; action?: ReactNode; children: ReactNode; className?: string })
  // com title: <section aria-labelledby> + <h2>; sem title: <div>
StatCard(props: { label: string; icon: LucideIcon; tone: Tone; cents?: number; value?: ReactNode; hint?: ReactNode })
  // role="group" aria-label=label
Chip(props: { selected: boolean; onClick(): void; children: ReactNode; icon?: LucideIcon })   // aria-pressed
ChipGroup(props: { label: string; children: ReactNode })                                      // role="group"
MonthSwitcher(props: { month: string /* "YYYY-MM" */; onChange(month: string): void; max?: string })
  // botões "Mês anterior"/"Próximo mês"; título "dezembro de 2026"
Skeleton(props: { variant?: "line"|"block"|"circle"; width?: string; height?: string })        // aria-hidden
SkeletonGroup(props: { label: string; children: ReactNode })  // role="status" aria-busy="true" aria-label=label
Sheet(props: { open: boolean; title: string; onClose(): void; children: ReactNode })
  // <dialog> nativo; baixo no celular, centro ≥1024px; Esc e "Fechar" fecham; foco volta ao gatilho
ListItem(props: { title: ReactNode; subtitle?: ReactNode; leading?: ReactNode; trailing?: ReactNode; onClick?(): void })
Avatar(props: { name: string; tone?: Tone })     // círculo com a inicial (no lugar de logos de banco)
SparkleIcon(props: { size?: number; title?: string })   // SVG próprio de 4 pontas, degradê via <linearGradient> com id único (useId)
HideValuesProvider({ children })
useHideValues(): { hidden: boolean; toggle(): void }    // localStorage "finance.hideValues", try/catch, padrão false
Money(props: { cents: number; signed?: boolean; tone?: "auto"|"none"; className?: string })
  // hidden → "R$ •••••" com aria-label "Valor oculto"; tone auto: >0 income, <0 expense
formatCents(cents: number): string   // reexport de features/chat/money.ts
```

- [ ] **Step 1: testes que falham** em `kit.test.tsx`:
```tsx
it("Money formata e respeita o olho", () => {
  render(<HideValuesProvider><Money cents={123456789} /><Toggle/></HideValuesProvider>);
  expect(screen.getByText("R$ 1.234.567,89")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Ocultar valores" }));
  expect(screen.getByLabelText("Valor oculto")).toBeInTheDocument();
});
it("Money negativo com sinal", () => { render(<Money cents={-5000} signed />); expect(screen.getByText("−R$ 50,00")).toBeInTheDocument(); });
it("useHideValues sobrevive a localStorage que lança", () => { vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error(); }); /* render não lança; hidden=false */ });
it("useHideValues persiste", () => { /* toggle → localStorage "finance.hideValues" = "1"; novo render já oculto */ });
it("MonthSwitcher vai e volta de mês", () => { /* "2026-12" → clicar "Próximo mês" chama onChange("2027-01"); "Mês anterior" → "2026-11"; max="2026-12" desabilita "Próximo mês" */ });
it("Sheet fecha com Esc e devolve o foco", ...);
it("ChipGroup expõe aria-pressed", ...);
it("SkeletonGroup anuncia carregando", () => { /* role status, aria-busy=true, nome = label */ });
it("SparkleIcon com dois na mesma tela não repete id de gradiente", ...);
```
  (`Toggle` = botão de teste que chama `toggle` com nome "Ocultar valores".)
- [ ] **Step 2:** `npm test -- kit` em `apps/web` → FAIL (módulos não existem).
- [ ] **Step 3:** implementar os componentes e `ui.css` com os tokens da R0-T1; `KitPage` mostra todos, nos dois temas.
- [ ] **Step 4:** `npm test -- kit` → PASS; `./tasks.ps1 check` → verde.

### Task R0-T3: Casca responsiva, rotas e e2e de navegação

**Files:**
- Create: `apps/web/src/shell/{nav.ts,BottomBar.tsx,Sidebar.tsx,Header.tsx,shell.css}`, `apps/web/src/shell/RouteSkeleton.tsx`
- Modify: `apps/web/src/shell/Shell.tsx`, `apps/web/src/app/App.tsx`, `apps/web/src/shell/tabs/*` (vira placeholders/reexports por rota)
- Create: placeholders `apps/web/src/features/{dashboard,transactions,reports}/…Page.tsx` (título + "Em construção") e
  `apps/web/src/features/admin/routes.tsx`
- Modify: `apps/api/tests/e2e/test_e2e_flows.py` (helpers `tab()`/`open_route()` e `TABS`), `apps/api/tests/e2e/e2e_support.py` se preciso
- Test: `apps/web/src/shell/__tests__/shell.test.tsx`

**Interfaces — Produces:**
```ts
// shell/nav.ts — fonte única dos menus
type NavItem = { to: string; label: string; icon: LucideIcon; adminOnly?: boolean; end?: boolean };
export const MOBILE_TABS: NavItem[]        // Início, Transações, Lançar(✦, centro), Relatórios, Mais
export const SIDEBAR_GROUPS: { label: string; items: NavItem[] }[]  // Controle, Planejamento, IA, Administração(adminOnly)
export const MORE_ITEMS: NavItem[]          // lista da tela Mais
export const ADMIN_SECTIONS: { slug: "usuarios"|"configuracoes"|"avisos"|"ia"|"auditoria"|"sistema"; label: string; icon: LucideIcon }[]
// shell/Shell.tsx usa useMediaQuery("(min-width: 1024px)") → Sidebar+Header ou BottomBar; HideValuesProvider envolve tudo
export function useMediaQuery(query: string): boolean   // em shell/useMediaQuery.ts
```
Suspense fallback = `RouteSkeleton` (cabeçalho + 3 cartões em skeleton). O ✦ no `BottomBar` é `NavLink` com nome
acessível "Lançar com IA", maior (64px), degradê, `SparkleIcon` dentro.

- [ ] **Step 1: testes que falham** em `shell.test.tsx`:
  - a 390px: `navigation "Principal"` tem links Início, Transações, Lançar com IA, Relatórios, Mais.
  - a 1280px: `navigation "Menu lateral"` tem Dashboard…Relatórios e **não** tem "Administração" para `role: "user"`;
    tem os seis itens de Administração para `role: "admin"`.
  - `/geral` redireciona para `/`; `/mais/admin` para `/admin/usuarios`; `/admin/ia` como Ruth → redireciona para `/`.
- [ ] **Step 2:** `npm test -- shell` → FAIL.
- [ ] **Step 3:** implementar casca, rotas e placeholders; telas antigas continuam alcançáveis nas rotas novas
  (provisório: `/` mostra `OverviewPage` atual até a U16; `/lancar` mostra `ChatPage`; `/metas`, `/plano` iguais;
  `/admin/*` renderiza a seção correspondente do `AdminPage` atual).
- [ ] **Step 4:** atualizar e2e: `TABS = ("Início","Transações","Lançar com IA","Relatórios","Mais")`; helper
  `go(page, label)` que toca o item no `navigation "Principal"` ou, se não estiver lá, abre Mais e toca o item;
  login agora cai no Dashboard (o teste de login espera `heading` do Dashboard placeholder "Início");
  chat via `go(page,"Lançar com IA")`; admin: Ruth não vê "Administração" em Mais nem no menu lateral.
- [ ] **Step 5:** `npm test` → PASS; `./tasks.ps1 check` e `./tasks.ps1 e2e` → verdes.

### Task R0-T4: Contrato `/reports/month`

**Files:** Modify `docs/api/openapi.yaml`; regenerar `apps/web/src/api/schema.d.ts` (`npm run gen:api`);
Create `apps/web/src/features/reports/api.ts` com
`useMonthReport(month: string, owner?: Owner): UseQueryResult<MonthReport>` (queryKey `["report", month, owner ?? "all"]`),
consumido por U16 e U21 em paralelo.

**Interfaces — Produces:** `GET /reports/month` (operationId `getMonthReport`, tag `reports`), query `month`
(obrigatório, `^\d{4}-(0[1-9]|1[0-2])$`), `owner` (opcional, `Owner`). Resposta `MonthReport`:
```yaml
MonthReport: {month: date(1º dia), income_cents, expense_cents, balance_cents,
  bills: {total_count, paid_count, paid_cents, open_count, open_cents},
  previous: {income_cents, expense_cents}, expense_delta_cents,
  by_category: [{category_id: int|null, name, total_cents, share_bp}],
  daily_cumulative_expense: {current: [{day, cents}], previous: [{day, cents}]}}
```
422 para mês inválido. Semântica exatamente a do spec (seção "Backend: relatório do mês").

- [ ] **Step 1:** escrever o schema e a rota no openapi; `npm run gen:api`; `npm run typecheck` → verde.
- [ ] **Step 2:** congelar a R0: `./tasks.ps1 check` + `./tasks.ps1 e2e` verdes; pedir ok do Matheus e commitar
  `feat: base do redesenho (kit, casca, rotas, contrato de relatórios)`.

---

## Onda R1 — Dados e gráficos (2 workers em paralelo, worktrees)
Depende de: R0 commitada. Alethe: playbook `parallel-worktrees` + `review-gate`.

### Task U14: Backend `GET /reports/month`

**Files:**
- Create: `apps/api/src/finance_api/reports/{__init__,schemas,service,router}.py`
- Modify: `apps/api/src/finance_api/main.py` (incluir router)
- Test: `apps/api/tests/reports/test_reports.py`

**Interfaces:**
- Consumes: contrato R0-T4; modelos `Transaction`, `Category`, `BillInstance`, `RecurringBill`; `ensure_upcoming_bill_instances`;
  dependências `DbSession`, `get_current_user` (mesmo padrão de `overview/router.py`); fuso `America/Sao_Paulo`.
- Produces: `build_month_report(db: Session, month: date, owner: Owner | None, today: date) -> MonthReport` em `service.py`.

- [ ] **Step 1: testes que falham:**
  - `test_mes_vazio_devolve_zeros` → todos os totais 0, `by_category == []`, `current` com 1 ponto por dia até hoje com 0.
  - `test_totais_receita_despesa_e_transferencia_ignorada` → receita 500000, despesa 120000 + transferência 30000 →
    `income_cents==500000`, `expense_cents==120000`, `balance_cents==380000`.
  - `test_por_categoria_ordenado_e_share_em_bp` → 75000 Mercado + 25000 sem categoria → `[("Mercado",7500),("Sem categoria",2500)]`.
  - `test_filtro_owner` → `owner=RUTH` soma só lançamentos com owner RUTH; sem owner soma todos.
  - `test_virada_de_mes_no_fuso_de_sp` → lançamento com data 2026-12-31 entra em dezembro, não em janeiro.
  - `test_acumulado_diario_mes_corrente_ate_hoje` → `today=2026-12-10`: `current` tem 10 pontos, `previous` tem 30
    (novembro); dia sem gasto repete o acumulado anterior.
  - `test_contas_fixas_do_mes` → 3 instâncias, 1 paga de 10000 → `bills == {3,1,10000,2,<soma das abertas>}`.
  - `test_mes_anterior_e_delta` → `expense_delta_cents == expense - previous.expense`.
  - `test_mes_invalido_422` → `month=2026-13` → 422.
- [ ] **Step 2:** `cd apps/api; uv run pytest tests/reports -v` → FAIL.
- [ ] **Step 3:** implementar com agregações SQL (`func.sum`, `group_by`) em centavos; sem float; `share_bp` com
  arredondamento meio-para-cima e soma podendo dar ≠ 10000 (documentar no docstring).
- [ ] **Step 4:** testes → PASS; `./tasks.ps1 check` → verde.

### Task U15: Componentes de gráfico

**Files:** Create `apps/web/src/ui/charts/{DonutChart,LineChart,BarChart,ChartTooltip,palette}.tsx`, `charts.css`;
Test `apps/web/src/ui/charts/__tests__/charts.test.tsx`.

**Interfaces — Produces:**
```ts
DonutChart(props: { label: string; data: { key: string; name: string; cents: number }[]; centerLabel?: ReactNode })
LineChart(props: { label: string; series: { name: string; points: { x: number; cents: number }[]; dashed?: boolean; tone: Tone }[]; xLabel?(x:number):string })
BarChart(props: { label: string; data: { key: string; label: string; values: { name: string; cents: number; tone: Tone }[] }[] })
CATEGORY_PALETTE: string[]   // 8 cores AA nos dois temas; categoria → cor estável por índice de ordenação
```
Cada gráfico: `figure` com `aria-label=label` + uma `<table className="visually-hidden">` com os mesmos dados
(acessível e testável); tooltip usa `Money` (respeita o olho); `ResponsiveContainer` sem largura fixa; dados vazios →
`EmptyState` "Sem dados neste período"; reduced-motion → `isAnimationActive={false}`.

- [ ] **Step 1: testes que falham:** tabela oculta tem as linhas certas; dados vazios mostram "Sem dados neste período";
  com olho ligado a tabela mostra "Valor oculto"; o `LineChart` aceita séries de tamanhos diferentes (10 e 30 pontos).
- [ ] **Step 2:** `npm test -- charts` → FAIL. **Step 3:** implementar com Recharts. **Step 4:** PASS + `check` verde.

**Gate R1:** revisão (agy) de U14 com foco em dinheiro/fuso/permissões; revisão de U15 com foco em a11y e olho.
Lead integra, roda `check` + `e2e`, ok do Matheus, commit.

---

## Onda R2 — Telas (8 workers em paralelo, worktrees; em 2 lotes de 4 se a cota pedir)
Depende de: R1 commitada. Cada unidade **só** mexe nos seus arquivos e no seu bloco de CSS; usa o kit sem alterá-lo
(precisa de algo novo no kit → pede ao lead, `NEEDS_CONTEXT`). Cada unidade troca `LoadingState` de tela por skeleton
com a forma do conteúdo e adiciona testes Vitest das próprias telas. Rotas e menus já existem (R0).

### Task U16: Dashboard (`/`)
**Files:** `features/dashboard/{DashboardPage,BalanceHero,MonthCards,MonthInsight,UpcomingBills,DebtsGoalsSummary,dashboard.css}.tsx`.
Consome `/overview`, `/goals`, `/debts`, `useMonthReport` (R0-T4), `LineChart`, `DonutChart`.
- [ ] Testes: saldo = `couple_total_cents` e não muda ao trocar o mês; "Expandir" mostra os três donos; quatro
  StatCards (Receitas, Despesas, Contas pagas "1 de 3", A pagar); insight "Você gastou R$ 50,00 a mais que no mês
  anterior" / "a menos" / some quando `previous` é zero; mês vazio → zeros + convite "Lance sua primeira despesa"
  com link para `/lancar`; ≥1024px mostra "Ritmo de gasto" e "Top 5 categorias" (5 maiores + "Outras").
- [ ] Remover o uso provisório de `OverviewPage` em `/`; `OverviewPage` sai quando U17 e U19 absorverem as seções.

### Task U17: Transações (`/transacoes`)
**Files:** `features/transactions/{TransactionsPage,TransactionFilters,TransactionList,TransactionSheet,transactions.css}.tsx`;
move `overview/TransactionsSection.tsx` e `overview/TxEditForm.tsx` para cá (mantendo os testes).
- [ ] Testes: lista agrupada por dia com cabeçalho "Hoje"/"Ontem"/"12 de dezembro"; chips Mês/Dono/Tipo e busca
  mantêm o comportamento atual; editar abre `Sheet` com o formulário atual; botões "Editar X"/"Excluir X" com os
  mesmos nomes acessíveis de hoje (os e2e de permissão dependem deles); exportar CSV continua.

### Task U18: Lançar (`/lancar`)
**Files:** `features/chat/*` (restilizar `ChatPage`, `Composer`, `DraftCard`, `ResultGroup`, `chat.css`);
`features/chat/ManualEntry.tsx` vira conteúdo de `Sheet` aberto por "Lançar à mão".
- [ ] Testes: region "Chat de lançamentos" e botões "Enviar"/"Confirmar X" com os mesmos nomes; "Lançar à mão" abre
  Sheet com seletor Receita/Despesa/Transferência que muda a cor do cabeçalho; valor grande; chips Hoje/Ontem/
  "Escolher data"; sem chips Único/Recorrente/Parcelado; link "Conta que se repete? Cadastre em Contas fixas" → `/contas-fixas`.

### Task U19: Contas fixas (`/contas-fixas`) e Contas (`/contas`)
**Files:** `features/bills/{FixedBillsPage,…}` (a partir de `FixedBillsSection`, `BillsSection`, `FixedBillFields`),
`features/accounts/{AccountsPage,…}` (a partir de `AccountsSection`, `AccountFormFields`, `BalancesSection`).
- [ ] Testes existentes das seções continuam passando com as páginas novas; lista com `ListItem` + `Avatar`; criar/editar
  em `Sheet`; contas a pagar com selo "Vence em 2 dias"/"Atrasada"; regras (409 → Encerrar, mês corrente SP) intactas.
  Ao fim, `OverviewPage` e `shell/tabs/GeralTab.tsx` deixam de ser usados (remover; manter `BalancesSection` se U16 usar).

### Task U20: Metas (`/metas`) e Plano (`/plano`)
**Files:** `features/goals/*`, `features/plan/*` (restilizar; `PlanPage` ganha `BarChart` dos `PlanProjection.months`).
- [ ] Testes: e2e atuais de Metas/Plano continuam (list "Metas", progressbar "Progresso de X", region "Resumo…");
  BarChart com uma barra por mês até `payoff_month` (saldo devedor) e legenda; resumo "Quitação em abril de 2027" em destaque.

### Task U21: Relatórios (`/relatorios`)
**Files:** `features/reports/{ReportsPage,PeriodChips,CategoryBreakdown,reports.css}.tsx`. Consome `useMonthReport` (U16).
- [ ] Testes: totais Receitas/Saídas/Balanço; chips "Esse mês"/"Mês passado"/"Escolher mês" (MonthSwitcher);
  chips de dono (Todos/Matheus/Ruth/Ambos) mudam o `owner`; rosca + lista com percentual ("85,5%") a partir de
  `share_bp`; linha do ritmo de gasto; mês vazio → EmptyState.

### Task U22: Administração (`/admin/*`)
**Files:** `features/admin/*` (`AdminPage` dá lugar a `routes.tsx` com uma página por seção; tabelas ≥1024px, `ListItem`
no celular; seção "Notificações" renomeada "Avisos do sistema"; cartões de números no topo do Sistema e da IA com
custo estimado).
- [ ] Testes: cada seção abre pela sua rota; Ruth recebe redirecionamento em todas; testes atuais das seções continuam.

### Task U23: Login, Mais e Preferências
**Files:** `auth/LoginPage.tsx` (+ CSS), `shell/tabs/MaisTab.tsx` → `features/settings/{MorePage,PreferencesPage}.tsx`.
- [ ] Testes: login mantém headings "Quem está entrando?" / "Olá, X. Digite seu PIN" e botões dos dígitos; teclado
  redondo; Mais lista `MORE_ITEMS` com ícones e "Sair"; Preferências tem `NotificationsCard`, instruções de instalar e
  alternador de tema (claro/escuro/automático, `data-theme` em `<html>`, lembrado no aparelho).

**Gate R2:** revisão por unidade (agy, só leitura): fidelidade ao spec, a11y, 360px sem rolagem, nomes acessíveis
mantidos, nenhum cálculo de dinheiro no front. Lead integra na ordem U23→U19→U17→U18→U20→U22→U16→U21, resolve conflitos
em `App.tsx`/CSS, roda `check` + `e2e`, ok do Matheus, commit.

---

## Onda R3 — Fechamento

### Task U24: e2e do redesenho
**Files:** `apps/api/tests/e2e/conftest.py` (terceiro aparelho `desktop` 1280×800), `test_e2e_flows.py`, novo `test_e2e_redesign.py`.
- [ ] Fluxos novos nos 3 aparelhos: Dashboard com os quatro cartões e troca de mês sem mudar o saldo; olho oculta e
  persiste após recarregar; ✦ abre o Lançar; Relatórios com rosca e tabela; Ruth sem Administração (menu e URL);
  `assert_layout` (sem rolagem horizontal) em todas as rotas; skeleton aparece (atrasar `/api/reports/month` com `page.route`).
- [ ] `./tasks.ps1 e2e` → verde.

### Task U25: Revisões e aprovação visual
- [ ] Revisão de dinheiro (U14 + telas que mostram valores) e de a11y/contraste (claro e escuro).
- [ ] Capturas de tela (Playwright) de cada rota nos 3 aparelhos e nos 2 temas, em `docs/referencia/visual/resultado/`
  (fora do git se pesar), para o Matheus comparar com as referências.
- [ ] Atualizar `.planning/STATE.md`; ok do Matheus; commit.

---

## Despacho no alethe (proposta; confirmar `usage`/`dry-run` antes de cada onda)
| Onda | Unidades | Quem | Playbook |
|---|---|---|---|
| R0 | T1–T4 | lead (Opus) | — (`note --kind lead`) |
| R1 | U14, U15 | builders Sonnet high (ou Codex se a cota sobrar) + revisores agy | parallel-worktrees + review-gate |
| R2 | U16–U23 | 8 builders Sonnet high (2 lotes de 4) + revisores agy | parallel-worktrees + review-gate |
| R3 | U24, U25 | builder Sonnet high (U24); revisão Opus (dinheiro) + agy (a11y); lead (capturas) | review-gate |
Briefs: um gerador por onda em `geradores/gen_redesign_rN.py`, como nas ondas anteriores; cada brief aponta para este
plano + o spec + a sua Task, com donos de arquivo explícitos.
