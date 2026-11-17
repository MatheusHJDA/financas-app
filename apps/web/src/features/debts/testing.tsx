// Apoio dos testes da tela do empréstimo (não é importado pelo app): servidor simulado de
// /debts, /debts/:id/installments e /recurring-bills por cima do servidor da tela Geral.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { components } from "../../api/schema";
import { AuthProvider } from "../../auth/AuthProvider";
import { json, makeServer, type Handler } from "../../test/appTesting";
import { HideValuesProvider } from "../../ui";

type Me = Parameters<typeof makeServer>[0];
export type Debt = components["schemas"]["Debt"];
export type Installment = components["schemas"]["Installment"];
export type LoanSummary = components["schemas"]["LoanSummary"];

export const DEBT_ID = 7;

export const LOAN_DEBT: Debt = {
  id: DEBT_ID,
  owner: "MATHEUS",
  name: "Empréstimo Nubank",
  principal_cents: 1_000_000,
  monthly_rate: "0.020000",
  installments: 13,
  installment_cents: 100_000,
  start_date: "2026-01-18",
  current_balance_cents: 1_300_000,
  paid_before_app_cents: 200_000,
  has_installments: true,
};

/** 13 parcelas mensais de R$ 1.000 a partir de 18/12/2026; hoje vale R$ 900 (economia R$ 100). */
export function makeInstallments(overrides: Record<number, Partial<Installment>> = {}): Installment[] {
  return Array.from({ length: 13 }, (_, i) => {
    const number = i + 1;
    const month = ((11 + i) % 12) + 1;
    const year = 2026 + Math.floor((11 + i) / 12);
    return {
      id: 100 + number,
      number,
      due_date: `${year}-${String(month).padStart(2, "0")}-18`,
      face_cents: 100_000,
      today_cents: 90_000,
      savings_cents: 10_000,
      status: "open" as const,
      paid_cents: null,
      paid_on: null,
      bill_instance_id: 500 + number,
      ...overrides[number],
    };
  });
}

export function summaryOf(items: Installment[], paidBefore = 200_000): LoanSummary {
  const open = items.filter((i) => i.status === "open");
  return {
    remaining_cents: open.reduce((s, i) => s + i.face_cents, 0),
    paid_cents: paidBefore + items.reduce((s, i) => s + (i.paid_cents ?? 0), 0),
    payoff_today_cents: open.reduce((s, i) => s + (i.today_cents ?? 0), 0),
    items,
  };
}

interface Opts {
  debt?: Debt;
  items?: Installment[];
  /** POST .../pay devolve este status e corpo em vez de pagar. */
  payError?: { status: number; detail: string };
  extra?: Record<string, Handler>;
}

export function makeLoanServer(me: Me, opts: Opts = {}) {
  const debt = opts.debt ?? LOAN_DEBT;
  const state = { items: opts.items ?? makeInstallments() };
  const routes: Record<string, Handler> = {
    "GET /debts": () => json({ items: [debt], total: 1 }),
    "GET /recurring-bills": () =>
      json({
        items: [
          {
            id: 9,
            owner: debt.owner,
            name: debt.name,
            amount_cents: debt.installment_cents,
            due_day: 18,
            start_month: "2026-12-01",
            end_month: null,
            account_id: 2,
            category_id: null,
            payment_method: null,
            debt_id: debt.id,
          },
        ],
        total: 1,
      }),
    "GET /debts/:id/installments": () => json(summaryOf(state.items)),
    "POST /debts/:id/installments/pay": async (req) => {
      if (opts.payError) return json({ detail: opts.payError.detail }, opts.payError.status);
      const b = (await req.clone().json()) as { installment_ids: number[]; amount_cents: number; date: string };
      state.items = state.items.map((i) =>
        b.installment_ids.includes(i.id)
          ? { ...i, status: "prepaid" as const, today_cents: null, savings_cents: null, paid_cents: b.amount_cents, paid_on: b.date }
          : i,
      );
      return json(summaryOf(state.items));
    },
    ...opts.extra,
  };
  return { ...makeServer(me, routes), state };
}

/** Renderiza a rota /dividas/:id com os provedores; devolve o QueryClient para espiar invalidações. */
export function renderLoan(ui: ReactElement, path = `/dividas/${DEBT_ID}`) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <HideValuesProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/dividas/:id" element={ui} />
              <Route path="/" element={<p>Início</p>} />
            </Routes>
          </MemoryRouter>
        </HideValuesProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { client, ...view };
}
