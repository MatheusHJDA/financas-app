# Empréstimo com parcelas — plano de execução

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O empréstimo do Nubank no app com todas as parcelas, valor hoje, adiantamento e a parcela do mês em Contas fixas.

**Architecture:** Tabela `debt_installments` ligada à dívida; cada parcela tem uma `bill_instance` própria de uma
`recurring_bills` marcada com `debt_id` (o gerador mensal pula essas). Um serviço (`debts/installments.py`) é o único
que muda parcelas + instâncias + `debts.current_balance_cents` juntos, de modo que Início, relatórios, avisos e
chat continuam lendo `bill_instances`/`debts` sem mudanças além do novo estado `prepaid`.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic, PostgreSQL, pytest; React + TypeScript, TanStack Query,
openapi-fetch (`docs/api/openapi.yaml` → `npm run gen:api`), vitest; Playwright (e2e em pytest).

**Spec:** `docs/superpowers/specs/2026-11-17-emprestimo-parcelas-design.md`

## Global Constraints

- Dinheiro sempre em centavos inteiros (`BigInteger`); nada de float em valores gravados.
- Datas de "hoje" sempre `today_sp()` (`bills/service.py`, America/Sao_Paulo).
- Toda mudança gravada passa por `record_audit` e por `ensure_can_write` / `ensure_can_move` (D6/D12).
- Todo pagamento cria **uma** despesa (`create_transaction`), categoria `Dívidas/Empréstimo`, valor = o digitado.
- Pagamento entra no relatório do mês em que o dinheiro saiu; parcela adiantada fica `prepaid` no mês dela e não
  soma em "Contas pagas", "a pagar" nem gera aviso.
- Dívidas sem parcelas cadastradas continuam como hoje.
- Contrato: toda rota nova vai em `docs/api/openapi.yaml` e em `EXPECTED` de `apps/api/tests/test_openapi_contract.py`;
  depois `npm run gen:api` em `apps/web`.
- Interface: kit `apps/web/src/ui/`, valores sempre por `Money` (olho), alvos ≥ 48px, layout ok em 360px.
- Gate de cada tarefa: testes da tarefa verdes + `uv run ruff check . && uv run ruff format --check .` (api) ou
  `npm run lint && npm run typecheck` (web). Gate final: `./tasks.ps1 check` e `./tasks.ps1 e2e` (Docker ligado).

## Review Focus

1. Excluir um adiantamento de 2+ parcelas reabre **todas** elas e suas instâncias (Task 3).
2. Editar o valor de um adiantamento reparte `paid_cents`; mudar o lançamento para receita libera as parcelas (Task 3).
3. Pagar uma parcela já paga/adiantada (pelas duas telas) → 409, sem lançamento novo (Tasks 3 e 4).
4. Parcela vencida e ainda aberta: valor hoje = valor cheio (nunca maior, nunca expoente negativo) (Task 2).
5. Pagar pela tela de Contas fixas uma instância de mês futuro vira `prepaid`; do mês corrente ou atrasada vira
   `paid` (Task 3).

---

## Arquivos

API (`apps/api/`):
- Create `alembic/versions/0002_debt_installments.py`
- Modify `src/finance_api/db/models.py` (Debt, RecurringBill, nova DebtInstallment, BILL_STATUS)
- Modify `src/finance_api/bills/service.py` (gerador pula `debt_id`)
- Create `src/finance_api/debts/present_value.py` (cálculo puro)
- Create `src/finance_api/debts/installments.py` (serviço)
- Create `src/finance_api/debts/schemas.py` (schemas novos; os de `debts/router.py` podem ficar onde estão)
- Modify `src/finance_api/debts/router.py` (rotas novas), `src/finance_api/bills/router.py` (pagar/editar/excluir),
  `src/finance_api/bills/schemas.py`, `src/finance_api/transactions/service.py` (liberar/repartir)
- Create `src/finance_api/seed/loan_nubank.py` (carga do empréstimo real)
- Tests: `tests/debts/test_present_value.py`, `tests/debts/test_installments.py`, `tests/debts/test_installments_api.py`,
  `tests/bills/test_debt_managed.py`, `tests/e2e/test_e2e_loan.py`
- Modify `docs/api/openapi.yaml`, `tests/test_openapi_contract.py`

Web (`apps/web/src/`):
- Create `features/debts/` (`api.ts`, `LoanPage.tsx`, `InstallmentList.tsx`, `PayInstallmentsSheet.tsx`,
  `loan.css`, `LoanPage.test.tsx`, `testing.tsx`)
- Modify `app/App.tsx` (rota `dividas/:id`), `shell/nav.ts` (Mais → Empréstimo/Dívidas),
  `features/dashboard/DebtsGoalsSummary.tsx` (link), `features/bills/PayableBills.tsx`, `features/bills/FixedBillsPage.tsx`,
  `api/schema.d.ts` (gerado)

---

### Task 1: Esquema — parcelas, conta fixa da dívida, estado `prepaid`

**Files:**
- Create: `apps/api/alembic/versions/0002_debt_installments.py`
- Modify: `apps/api/src/finance_api/db/models.py`, `apps/api/src/finance_api/bills/service.py`
- Test: `apps/api/tests/test_models.py`, `apps/api/tests/bills/test_generation.py`

**Interfaces:**
- Produces:
  - `BILL_STATUS = Enum("open", "paid", "prepaid", name="bill_status")`
  - `INSTALLMENT_STATUS = Enum("open", "paid", "prepaid", name="installment_status")`
  - `Debt.paid_before_app_cents: int` (default 0, server_default "0")
  - `RecurringBill.debt_id: int | None` (FK `debts.id`, `ondelete="RESTRICT"`, unique)
  - `DebtInstallment` (`debt_installments`): `id`, `debt_id` (FK RESTRICT), `number: int`, `due_date: date`,
    `face_cents: int`, `status` (INSTALLMENT_STATUS, default open), `paid_cents: int | None`, `paid_on: date | None`,
    `transaction_id: int | None` (FK `transactions.id` SET NULL), `bill_instance_id: int` (FK `bill_instances.id`
    RESTRICT, unique), `created_at`, `updated_at`; `UniqueConstraint(debt_id, number)`,
    `CheckConstraint("face_cents > 0")`, `Index(transaction_id)`.

- [ ] **Step 1: Testes que falham**
  - `test_models.py::test_debt_installment_roundtrip`: cria Debt + RecurringBill(debt_id) + BillInstance +
    DebtInstallment, lê de volta; `status == "open"`, `paid_cents is None`.
  - `test_models.py::test_bill_status_accepts_prepaid`: BillInstance com `status="prepaid"` grava.
  - `test_generation.py::test_ensure_skips_debt_managed_bills`: RecurringBill com `debt_id` + uma comum, ambas
    vigentes; `ensure_bill_instances(db, date(2026,12,1)) == 1` e nenhuma instância criada para a da dívida.
- [ ] **Step 2:** `cd apps/api; uv run pytest tests/test_models.py tests/bills/test_generation.py -q` → FAIL.
- [ ] **Step 3:** Migração `0002_debt_installments` (`down_revision = "0001_initial"`): `ALTER TYPE bill_status ADD
  VALUE 'prepaid'` (em `op.get_context().autocommit_block()`), cria `installment_status`, a coluna em `debts` e em
  `recurring_bills`, e a tabela. `downgrade` remove tabela/colunas/tipo novo (valor de enum não volta; documentar).
  Modelos espelhando. Em `ensure_bill_instances`, filtro `RecurringBill.debt_id.is_(None)`.
- [ ] **Step 4:** Mesmo comando → PASS; `uv run pytest tests/test_migration_offline.py -q` → PASS.
- [ ] **Step 5:** Commit `feat(api): esquema de parcelas do empréstimo`.

### Task 2: Valor hoje (valor presente)

**Files:**
- Create: `apps/api/src/finance_api/debts/present_value.py`
- Test: `apps/api/tests/debts/test_present_value.py`

**Interfaces:**
- Produces: `present_value_cents(face_cents: int, due: date, today: date, monthly_rate: Decimal) -> int`
  (`ROUND_HALF_UP`; `due <= today` → `face_cents`).

- [ ] **Step 1: Testes que falham**
  - `test_matches_nubank_within_tolerance`: hoje `date(2026,11,17)`, taxa `Decimal("0.0345")`, face `141757`;
    pares (vencimento → centavos do Nubank): 2026-12-18→136880, 2027-01-18→132315, 2027-02-18→127902,
    2027-03-18→123637, 2027-04-19→119514, 2027-05-18→115528, 2027-06-18→111675, 2027-07-19→107951,
    2027-08-18→104351, 2027-09-20→100871, 2027-10-18→97507, 2027-11-18→94255, 2027-12-20→91112;
    para cada um `abs(pv - nubank) <= nubank * 0.003`; e `abs(sum(pvs) - 1463495) <= 1463495 * 0.003`.
  - `test_due_today_or_past_is_face`: `due == today` e `due < today` → `141757`.
  - `test_decreases_with_distance`: lista acima estritamente decrescente.
- [ ] **Step 2:** `uv run pytest tests/debts/test_present_value.py -q` → FAIL.
- [ ] **Step 3:** Ponto de partida medido pelo lead: meses inteiros de calendário entre `today` e `due` (`n`) +
  dias restantes (`d`), `face / (1+i)^(n + d/30)`. Erra ≤ 4 centavos nas 3 primeiras e ~0,23% na 13ª. Se algum par
  passar de 0,3%, calibrar (ex.: dias corridos/30, base 365/12) e anotar a escolha no docstring.
- [ ] **Step 4:** Mesmo comando → PASS.
- [ ] **Step 5:** Commit `feat(api): valor presente das parcelas`.

### Task 3: Serviço das parcelas (cadastro, pagar/adiantar, liberar, repartir)

**Files:**
- Create: `apps/api/src/finance_api/debts/installments.py`
- Modify: `apps/api/src/finance_api/transactions/service.py` (`release_bill_instance`, `update_transaction`)
- Test: `apps/api/tests/debts/test_installments.py`

**Interfaces:**
- Consumes: Task 1 modelos; Task 2 `present_value_cents`; `create_transaction`, `TxData` (`transactions/service.py`);
  `ensure_can_write`; `record_audit`; `today_sp`.
- Produces:
  - `@dataclass InstallmentSpec(number: int, due_date: date, face_cents: int)`
  - `set_schedule(db, user, debt: Debt, specs: list[InstallmentSpec], paid_before_app_cents: int,
    account_id: int | None, category_id: int | None) -> None` — cria (ou recria, se nenhuma parcela tiver sido paga)
    a `recurring_bills` da dívida (`name=debt.name`, `owner=debt.owner`, `amount_cents` = face da 1ª,
    `due_day` = dia da 1ª, `start_month`/`end_month` = meses da 1ª/última, `debt_id=debt.id`), uma `BillInstance`
    por parcela (`month` = 1º dia do mês do vencimento, `due_date`, `amount_cents=face`), as parcelas, e
    `debt.paid_before_app_cents`. Ao final chama `sync_balance`. Recusa (`ValueError`) se já houver parcela paga,
    meses repetidos ou `number` repetido.
  - `pay_installments(db, user, debt: Debt, installment_ids: list[int], amount_cents: int, account_id: int,
    paid_on: date) -> Transaction` — 409 (`HTTPException`) se alguma não estiver `open`; 422 se lista vazia, de outra
    dívida ou `amount_cents <= 0`. Cria uma despesa (`description` = `f"{debt.name} — parcela 3ª"` para uma,
    `f"{debt.name} — adiantamento parcelas 12ª, 13ª"` para várias; categoria = a da conta fixa da dívida). Cada
    parcela: `status = "prepaid"` se `first_of_month(due_date) > first_of_month(paid_on)`, senão `"paid"`; mesmo
    status na `BillInstance`, `paid_transaction_id = tx.id`; `transaction_id = tx.id`. `paid_cents` repartido por
    `split_amount`. `sync_balance` no fim.
  - `split_amount(total_cents: int, weights: list[int]) -> list[int]` — proporcional aos pesos, soma exata, resto na
    última.
  - `release_installments(db, user, tx: Transaction) -> bool` — se houver parcelas com `transaction_id == tx.id`,
    volta todas e suas instâncias para `open` (zera `paid_*`, `paid_transaction_id`), audita, `sync_balance`,
    devolve True.
  - `resplit_installments(db, tx: Transaction, today: date) -> None` — repartir `tx.amount_cents` pelos valores hoje
    na data `tx.date`, e `paid_on = tx.date` (o status prepaid/paid é recalculado com a nova data).
  - `sync_balance(db, debt: Debt) -> None` — `current_balance_cents` = soma de `face_cents` das parcelas `open`.
  - `loan_summary(db, debt: Debt, today: date) -> LoanSummary` com `remaining_cents`, `paid_cents`
    (`paid_before_app_cents` + soma de `paid_cents`), `payoff_today_cents` (soma do valor hoje das abertas) e
    `items: list[InstallmentView(id, number, due_date, face_cents, today_cents, savings_cents, status, paid_cents,
    paid_on, bill_instance_id)]` em ordem de `number`.
- No `transactions/service.py`: `release_bill_instance` chama `release_installments` primeiro e retorna se True;
  `update_transaction`, quando o lançamento continua despesa e mudou `amount_cents` ou `date`, chama
  `resplit_installments`.

- [ ] **Step 1: Testes que falham** (`tests/debts/test_installments.py`, fixture com dívida AMBOS, conta Nubank,
  categoria `Dívidas/Empréstimo`, 13 parcelas de 141757 com as datas do spec, `paid_before_app_cents=818799`):
  - `test_set_schedule_creates_bill_and_instances`: 1 `recurring_bills` com `debt_id`, 13 instâncias `open` com as
    `due_date`s do spec; `debt.current_balance_cents == 13 * 141757`.
  - `test_summary_totals`: `remaining_cents == 1842841`, `paid_cents == 818799`, `payoff_today_cents` em ±0,3% de
    1463495 com `today=date(2026,11,17)`.
  - `test_prepay_last_two_creates_one_expense`: pagar 12ª+13ª com `amount_cents=185367`, `paid_on=date(2026,11,17)`
    → 1 lançamento novo (`kind="expense"`, `amount_cents=185367`, `date=2026-11-17`, descrição
    `"Empréstimo — adiantamento parcelas 12ª, 13ª"` para dívida chamada "Empréstimo"); as duas parcelas e instâncias
    `prepaid`; soma dos `paid_cents == 185367`; `current_balance_cents == 11 * 141757`.
  - `test_pay_in_due_month_is_paid`: 1ª parcela paga em `2026-12-10` → `paid`; instância `paid`.
  - `test_pay_overdue_is_paid`: 1ª paga em `2027-01-05` → `paid`.
  - `test_pay_twice_conflict`: pagar a 13ª de novo → 409; nenhum lançamento a mais.
  - `test_delete_prepayment_reopens_all`: excluir o lançamento do adiantamento (rota `DELETE /transactions/{id}` ou
    `release_bill_instance`) → 12ª e 13ª `open`, instâncias `open`, `paid_cents is None`, saldo volta a 13×141757.
  - `test_edit_amount_resplits`: `update_transaction(..., {"amount_cents": 180000})` → soma dos `paid_cents == 180000`.
  - `test_change_to_income_releases`: mudar `kind` para `income` → parcelas `open`.
  - `test_split_amount_exact`: `split_amount(100, [1, 1, 1]) == [33, 33, 34]`.
  - `test_ruth_can_pay_ambos_debt`: usuária RUTH paga a 1ª da dívida AMBOS na conta AMBOS → ok.
  - `test_set_schedule_refuses_after_payment`: após um pagamento, `set_schedule` → `ValueError`.
- [ ] **Step 2:** `uv run pytest tests/debts/test_installments.py -q` → FAIL.
- [ ] **Step 3:** Implementar as interfaces acima.
- [ ] **Step 4:** Mesmo comando → PASS; `uv run pytest tests/transactions tests/bills -q` → PASS (nada quebrou).
- [ ] **Step 5:** Commit `feat(api): serviço de parcelas e adiantamento`.

### Task 4: Rotas e contrato

**Files:**
- Create: `apps/api/src/finance_api/debts/schemas.py`
- Modify: `apps/api/src/finance_api/debts/router.py`, `apps/api/src/finance_api/bills/router.py`,
  `apps/api/src/finance_api/bills/schemas.py`, `docs/api/openapi.yaml`, `apps/api/tests/test_openapi_contract.py`
- Test: `apps/api/tests/debts/test_installments_api.py`, `apps/api/tests/bills/test_debt_managed.py`

**Interfaces:**
- Consumes: Task 3.
- Produces (HTTP):
  - `GET /debts/{id}/installments` → `LoanSummaryOut {remaining_cents, paid_cents, payoff_today_cents,
    items: InstallmentOut[]}`; dívida sem parcelas → `items: []`, demais campos 0 exceto `remaining_cents =
    current_balance_cents`.
  - `POST /debts/{id}/installments/pay` body `PayInstallmentsIn {installment_ids: int[] (min 1), amount_cents: int
    (>0), account_id: int, date: date}` → `LoanSummaryOut` (201 não; 200).
  - `DebtOut` ganha `paid_before_app_cents: int` e `has_installments: bool`.
  - `BillInstanceOut.status`: `Literal["open", "paid", "prepaid"]`; ganha `debt_id: int | None`.
  - `RecurringBillOut` ganha `debt_id: int | None`.
  - `BillPayRequest` ganha `amount_cents: int | None`, `account_id: int | None`, `date: date | None`.
  - `/bill-instances/{id}/pay` numa instância de dívida: exige `amount_cents` + `account_id` (422 sem eles), aceita
    `date` (padrão hoje) e delega a `pay_installments`; com `transaction_id` usa o valor e a data desse lançamento.
    Instância `prepaid` → 409.
  - `PATCH`/`DELETE /recurring-bills/{id}` de conta com `debt_id` → 409 `"Esta conta é do empréstimo; altere pela
    tela do empréstimo."`
  - `/bill-instances` (lista) não lista `prepaid` por padrão no filtro `status=open`; sem filtro lista com status.
  - `PATCH /debts/{id}` em dívida com parcelas: `current_balance_cents` e `installment_cents` → 409 (são derivados).
- [ ] **Step 1: Testes que falham** — um teste por item acima, com cliente HTTP (`client_as` de `conftest.py`),
  incluindo: `test_pay_from_bills_requires_amount` (422), `test_pay_from_bills_future_month_is_prepaid`,
  `test_prepaid_instance_pay_conflict` (409), `test_cannot_edit_or_delete_debt_bill` (409 nos dois),
  `test_overview_and_report_ignore_prepaid` (`GET /overview` não lista a instância prepaid nas próximas contas;
  `GET /reports/month?month=2027-12` não a conta em pagas nem em abertas), `test_notifications_skip_prepaid`
  (`_open_bills_due` não a devolve). Adicionar as 2 rotas novas a `EXPECTED`.
- [ ] **Step 2:** `uv run pytest tests/debts tests/bills tests/test_openapi_contract.py -q` → FAIL.
- [ ] **Step 3:** Implementar rotas e schemas; atualizar `docs/api/openapi.yaml`.
- [ ] **Step 4:** `uv run pytest -q` (suíte inteira) → PASS; ruff ok.
- [ ] **Step 5:** `cd apps/web; npm run gen:api; npm run typecheck` → ok. Commit `feat(api): rotas do empréstimo`.

### Task 5: Tela do empréstimo (web)

**Files:**
- Create: `apps/web/src/features/debts/{api.ts,LoanPage.tsx,InstallmentList.tsx,PayInstallmentsSheet.tsx,loan.css,testing.tsx,LoanPage.test.tsx}`
- Modify: `apps/web/src/app/App.tsx`, `apps/web/src/shell/nav.ts`, `apps/web/src/features/dashboard/DebtsGoalsSummary.tsx`

**Interfaces:**
- Consumes: Task 4 (`GET /debts/{id}/installments`, `POST /debts/{id}/installments/pay`, `GET /accounts`).
- Produces: rota `/dividas/:id`; `useLoan(id)` (queryKey `["debts", id, "installments"]`); `AFTER_LOAN_PAID =
  ["debts", "bill-instances", "overview", "transactions", "accounts", "goals", "report"]`.

Tela (texto, pt-BR):
- Topo: "Restante a pagar" (grande), "Total pago", "Quitar hoje (estimativa)".
- Lista: "1ª · 18 dez. 2026", valor hoje em destaque, valor cheio riscado/menor e "economiza R$ X" quando > 0;
  pagas/adiantadas no fim com selo "Paga em 17/11" / "Adiantada em 17/11" e o valor pago, sem caixa de seleção.
- Caixa de seleção por parcela aberta; atalho "Selecionar as últimas" não é pedido (YAGNI).
- Barra fixa embaixo (acima da barra de navegação no celular) quando há seleção: total estimado, "Você economiza
  R$ X", botão "Revisar" → `PayInstallmentsSheet` com campos "Valor cobrado" (pré-preenchido com a soma dos valores
  hoje), "Conta" (padrão: conta da conta fixa da dívida), "Data" (hoje) e botão "Confirmar pagamento".
- Dívida sem parcelas: só "Saldo devedor" e a frase "Esta dívida não tem parcelas cadastradas."
- Entrada: cada item do card "Dívidas" do Início vira link para `/dividas/:id`; em `nav.ts` (Mais e menu lateral)
  item "Dívidas" → rota `/dividas`, que redireciona para a primeira dívida com `has_installments` (ou para `/` se
  nenhuma).

- [ ] **Step 1: Testes que falham** (`LoanPage.test.tsx`, MSW/fixtures no padrão de `features/goals/testing.tsx`):
  `mostra restante, total pago e quitar hoje`; `lista 13 parcelas em ordem com valor hoje e economia`;
  `selecionar 12ª e 13ª mostra total e economia na barra`; `confirmar envia installment_ids, amount_cents digitado,
  account_id e date` e invalida `AFTER_LOAN_PAID`; `parcela adiantada aparece com selo e sem caixa`;
  `olho oculta todos os valores`; `erro 409 mostra "Essa parcela já foi paga." e recarrega`.
- [ ] **Step 2:** `cd apps/web; npx vitest run src/features/debts` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Mesmo comando → PASS; `npm run lint && npm run typecheck` → ok.
- [ ] **Step 5:** Commit `feat(web): tela do empréstimo`.

### Task 6: Contas fixas e Início com parcelas do empréstimo

**Files:**
- Modify: `apps/web/src/features/bills/PayableBills.tsx`, `apps/web/src/features/bills/FixedBillsPage.tsx`,
  `apps/web/src/features/dashboard/UpcomingBills.tsx` (só se mostrar status)
- Test: `apps/web/src/features/bills/FixedBillsPage.test.tsx`

**Interfaces:**
- Consumes: Task 4 (`debt_id` em `BillInstanceOut`/`RecurringBillOut`, status `prepaid`, `BillPayRequest` novo);
  Task 5 `PayInstallmentsSheet` (reaproveitado com uma parcela).

- [ ] **Step 1: Testes que falham**: `pagar parcela do empréstimo abre o formulário com valor, conta e data`
  (envia `amount_cents`/`account_id`/`date`); `conta fixa do empréstimo não tem Editar/Excluir e mostra link
  "Ver empréstimo"`; `instância adiantada mostra selo "Adiantada" e não tem botão Pagar`.
- [ ] **Step 2:** `npx vitest run src/features/bills` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Mesmo comando → PASS; lint/typecheck ok.
- [ ] **Step 5:** Commit `feat(web): parcelas do empréstimo em Contas fixas`.

### Task 7: Carga do empréstimo real e e2e

**Files:**
- Create: `apps/api/src/finance_api/seed/loan_nubank.py`, `apps/api/tests/seed/test_loan_nubank.py`,
  `apps/api/tests/e2e/test_e2e_loan.py`

**Interfaces:**
- Consumes: Task 3 `set_schedule`, `InstallmentSpec`.
- Produces: `python -m finance_api.seed.loan_nubank [--apply]` — sem `--apply` só imprime o que faria (dry-run).
  Dados fixos: dívida `id=1`; corrige `principal_cents=2265965`, `monthly_rate=0.0345`, `installments=13`,
  `installment_cents=141757`, `name="Empréstimo Nubank"`; 13 `InstallmentSpec` com as datas do spec e
  `face_cents=141757`, exceto a 13ª com `141758` (centavo do total 18.428,42 — **lead confirma com Matheus antes do
  `--apply`**); `paid_before_app_cents=818799`; conta `Nubank (Matheus)` (busca por nome; falha se não achar);
  categoria `Dívidas/Empréstimo` (busca por nome). Usuário de auditoria: o primeiro admin.

- [ ] **Step 1: Testes que falham**: `test_dry_run_changes_nothing`; `test_apply_loads_schedule` (13 parcelas,
  soma de face 1842842, `paid_before_app_cents == 818799`, nome atualizado); `test_apply_twice_is_refused_after_payment`.
  e2e (`test_e2e_loan.py`, nos 3 aparelhos do `conftest`): abrir `/dividas/1`, conferir "Restante a pagar",
  selecionar a última parcela, Revisar, Confirmar → selo "Adiantada"; em `/contas-fixas` no mês dela → "Adiantada";
  layout sem estouro em 360px (`assert_layout`).
- [ ] **Step 2:** `uv run pytest tests/seed/test_loan_nubank.py -q` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `./tasks.ps1 check` e `./tasks.ps1 e2e` → verdes.
- [ ] **Step 5:** Commit `feat: carga do empréstimo Nubank e e2e`.

### Task 8 (lead, com Matheus): aplicar no banco real

- [ ] `./tasks.ps1 backup` → anotar o arquivo.
- [ ] `./tasks.ps1 up` (sobe o código novo; migração roda na subida).
- [ ] Confirmar o centavo com Matheus; `docker exec financas-api-1 python -m finance_api.seed.loan_nubank` (dry-run),
  conferir, depois com `--apply`.
- [ ] Abrir `https://optimousprime.tail6cabb8.ts.net/dividas/1` e comparar com as capturas do Nubank.
- [ ] Atualizar `.planning/STATE.md`.
