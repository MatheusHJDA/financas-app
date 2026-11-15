// Apoio dos testes do Dashboard (não é importado pelo app): API simulada, fixtures e render com os provedores.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import type { components } from "../../api/schema";
import { AuthProvider } from "../../auth/AuthProvider";
import { HideValuesProvider } from "../../ui";

type Overview = components["schemas"]["Overview"];
type Account = components["schemas"]["Account"];
type BillInstance = components["schemas"]["BillInstance"];
type Goal = components["schemas"]["Goal"];
type Debt = components["schemas"]["Debt"];
export type MonthReport = components["schemas"]["MonthReport"];

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const account = (id: number, name: string, owner: Account["owner"], type: Account["type"], balance: number): Account => ({
  id,
  owner,
  created_by: owner === "RUTH" ? 2 : 1,
  name,
  type,
  initial_balance_cents: balance,
  initial_balance_date: "2026-01-01",
  active: true,
  current_balance_cents: balance,
});

const groupOf = (owner: Account["owner"], accounts: Account[]) => ({
  owner,
  accounts,
  total_cents: accounts.reduce((s, a) => s + a.current_balance_cents, 0),
});

const RUTH_ACCOUNTS = [account(1, "Nubank Ruth", "RUTH", "checking", 150_000), account(4, "Cartão Nubank", "RUTH", "credit_card", -42_000)];
const MATHEUS_ACCOUNTS = [account(2, "Itaú Matheus", "MATHEUS", "checking", 300_000)];
const AMBOS_ACCOUNTS = [account(3, "Reserva casal", "AMBOS", "savings", 500_000)];

const bill = (id: number, name: string, owner: BillInstance["owner"], due: string, amount: number): BillInstance => ({
  id,
  recurring_bill_id: id,
  name,
  owner,
  month: "2026-11-01",
  due_date: due,
  amount_cents: amount,
  status: "open",
});

export const OVERVIEW: Overview = {
  balances_by_owner: [groupOf("RUTH", RUTH_ACCOUNTS), groupOf("MATHEUS", MATHEUS_ACCOUNTS), groupOf("AMBOS", AMBOS_ACCOUNTS)],
  couple_total_cents: 908_000, // 1.500 + 3.000 + 5.000 − 420
  open_card_invoices: [{ account_id: 4, account_name: "Cartão Nubank", open_amount_cents: 42_000, due_date: "2026-11-20" }],
  debts_balance_cents: 800_000,
  upcoming_bills: [bill(31, "Luz", "MATHEUS", "2026-11-15", 18_950), bill(33, "Aluguel", "AMBOS", "2026-11-20", 150_000)],
  overdue_bills: [bill(32, "Internet", "RUTH", "2026-11-05", 9990)],
};

export const GOALS: Goal[] = [
  {
    id: 1,
    owner: "AMBOS",
    type: "accumulate",
    name: "Reserva de emergência",
    target_cents: 500_000,
    due_date: "2027-06-30",
    active: true,
    progress: { current_cents: 120_000, target_cents: 500_000, percent: 24, level: null },
  },
  {
    id: 2,
    owner: "RUTH",
    type: "category_cap",
    name: "Mercado do mês",
    target_cents: 40_000,
    active: true,
    progress: { current_cents: 52_000, target_cents: 40_000, percent: 130, level: null },
  },
  {
    id: 3,
    owner: "MATHEUS",
    type: "accumulate",
    name: "Meta arquivada",
    target_cents: 10_000,
    active: false,
    progress: { current_cents: 0, target_cents: 10_000, percent: 0, level: null },
  },
];

export const DEBTS: Debt[] = [
  {
    id: 1,
    owner: "MATHEUS",
    name: "Empréstimo do carro",
    principal_cents: 1_000_000,
    monthly_rate: "0.015",
    installments: 24,
    installment_cents: 50_000,
    start_date: "2026-01-10",
    current_balance_cents: 800_000,
  },
];

const cat = (id: number | null, name: string, total: number, bp: number) => ({ category_id: id, name, total_cents: total, share_bp: bp });

export const REPORT_NOV: MonthReport = {
  month: "2026-11-01",
  income_cents: 840_000,
  expense_cents: 512_000,
  balance_cents: 328_000,
  bills: { total_count: 3, paid_count: 1, paid_cents: 10_000, open_count: 2, open_cents: 38_000 },
  previous: { income_cents: 800_000, expense_cents: 507_000 },
  expense_delta_cents: 5000,
  by_category: [
    cat(1, "Mercado", 200_000, 3906),
    cat(2, "Aluguel", 100_000, 1953),
    cat(3, "Transporte", 80_000, 1563),
    cat(4, "Lazer", 60_000, 1172),
    cat(5, "Saúde", 40_000, 781),
    cat(6, "Educação", 20_000, 391),
    cat(null, "Sem categoria", 12_000, 234),
  ],
  daily_cumulative_expense: {
    current: [
      { day: 1, cents: 10_000 },
      { day: 2, cents: 10_000 },
      { day: 3, cents: 35_000 },
    ],
    previous: [
      { day: 1, cents: 5000 },
      { day: 2, cents: 20_000 },
      { day: 3, cents: 20_000 },
    ],
  },
};

export const emptyReport = (month: string): MonthReport => ({
  month: `${month}-01`,
  income_cents: 0,
  expense_cents: 0,
  balance_cents: 0,
  bills: { total_count: 0, paid_count: 0, paid_cents: 0, open_count: 0, open_cents: 0 },
  previous: { income_cents: 0, expense_cents: 0 },
  expense_delta_cents: 0,
  by_category: [],
  daily_cumulative_expense: { current: [], previous: [] },
});

export interface Call {
  key: string;
  req: Request;
}

export interface ApiOptions {
  report?: (month: string) => MonthReport | Response;
  overview?: Overview | Response;
  goals?: Goal[] | Response;
  debts?: Debt[] | Response;
}

/** fetch simulado do que o Dashboard chama. Devolve a lista de chamadas feitas. */
export function mockApi(opts: ApiOptions = {}) {
  const calls: Call[] = [];
  const reply = (v: unknown) => (v instanceof Response ? v : json(v));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request) => {
      const url = new URL(req.url);
      const path = url.pathname.replace(/^\/api/, "");
      calls.push({ key: `${req.method} ${path}`, req });
      if (req.method !== "GET") return json({ detail: "não mockado" }, 500);
      if (path === "/auth/me") return json({ id: 1, name: "Matheus", role: "admin", owner: "MATHEUS" });
      if (path === "/overview") return reply(opts.overview ?? OVERVIEW);
      if (path === "/reports/month") {
        const month = url.searchParams.get("month") ?? "";
        return reply(opts.report ? opts.report(month) : REPORT_NOV);
      }
      if (path === "/goals") {
        const items = opts.goals ?? GOALS;
        return items instanceof Response ? items : json({ items, total: items.length });
      }
      if (path === "/debts") {
        const items = opts.debts ?? DEBTS;
        return items instanceof Response ? items : json({ items, total: items.length });
      }
      return json({ detail: "não mockado" }, 500);
    }),
  );
  return calls;
}

/** Chamadas a um caminho, com os parâmetros de busca. */
export const searchesOf = (calls: Call[], key: string) =>
  calls.filter((c) => c.key === key).map((c) => new URL(c.req.url).searchParams);

/** Simula a largura da tela: só a media query de largura mínima (1024px) importa. */
export function setWidth(width: number) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      const m = /min-width:\s*(\d+)px/.exec(query);
      return {
        matches: m ? width >= Number(m[1]) : false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      };
    }),
  );
}

export function renderDashboard(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <HideValuesProvider>
          <MemoryRouter>{ui}</MemoryRouter>
        </HideValuesProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
}
