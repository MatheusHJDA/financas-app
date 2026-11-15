// Apoio dos testes das telas Geral e Metas (não é importado pelo app): API simulada com estado,
// dois usuários (Ruth = member, Matheus = admin) e render com os provedores.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import type { components } from "../api/schema";
import { AuthProvider } from "../auth/AuthProvider";

type Me = components["schemas"]["Me"];
type Account = components["schemas"]["Account"];
type Category = components["schemas"]["Category"];
type Transaction = components["schemas"]["Transaction"];
type BillInstance = components["schemas"]["BillInstance"];
type Goal = components["schemas"]["Goal"];
type Overview = components["schemas"]["Overview"];

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export type Params = Record<string, string>;
export type Handler = (req: Request, params: Params) => Response | Promise<Response>;

export interface Call {
  key: string;
  req: Request;
}

/** Rota "MÉTODO /caminho/:param" -> regex. */
function compile(route: string) {
  const [method, path] = route.split(" ");
  const names: string[] = [];
  const pattern = path.replace(/:([a-z_]+)/g, (_m, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  return { method, names, regex: new RegExp(`^${pattern}$`) };
}

/** fetch simulado por "MÉTODO /caminho" (sem o prefixo /api); aceita ":id" no caminho. */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const compiled = Object.entries(routes).map(([route, handler]) => ({ ...compile(route), handler }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request) => {
      const path = new URL(req.url).pathname.replace(/^\/api/, "");
      calls.push({ key: `${req.method} ${path}`, req });
      for (const r of compiled) {
        if (r.method !== req.method) continue;
        const m = r.regex.exec(path);
        if (!m) continue;
        const params: Params = {};
        r.names.forEach((n, i) => (params[n] = m[i + 1]));
        return r.handler(req, params);
      }
      return json({ detail: "não mockado" }, 500);
    }),
  );
  return calls;
}

export const RUTH: Me = { id: 2, name: "Ruth", role: "member", owner: "RUTH" };
export const MATHEUS: Me = { id: 1, name: "Matheus", role: "admin", owner: "MATHEUS" };

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

export const ACCOUNTS: Account[] = [
  account(1, "Nubank Ruth", "RUTH", "checking", 150_000),
  account(2, "Itaú Matheus", "MATHEUS", "checking", 300_000),
  account(3, "Reserva casal", "AMBOS", "savings", 500_000),
  account(4, "Cartão Nubank", "RUTH", "credit_card", -42_000),
];

export const CATEGORIES: Category[] = [
  { id: 10, name: "Mercado", kind: "expense", is_recurring_card_allowed: false },
  { id: 11, name: "Salário", kind: "income", is_recurring_card_allowed: false },
  { id: 12, name: "Energia elétrica", kind: "expense", is_recurring_card_allowed: false },
  { id: 13, name: "Combustível", kind: "expense", is_recurring_card_allowed: false },
  { id: 15, name: "Uber", kind: "income", is_recurring_card_allowed: false },
];

const tx = (
  id: number,
  description: string,
  owner: Transaction["owner"],
  kind: Transaction["kind"],
  amount: number,
  accountId: number,
  date: string,
  categoryId: number | null = null,
): Transaction => ({
  id,
  kind,
  amount_cents: amount,
  date,
  description,
  account_id: accountId,
  to_account_id: null,
  category_id: categoryId,
  owner,
  created_by: owner === "RUTH" ? 2 : 1,
  status: "confirmed",
  source: "manual",
});

export const TRANSACTIONS: Transaction[] = [
  tx(1, "Supermercado BH", "RUTH", "expense", 4590, 1, "2026-11-10", 10),
  tx(2, "Gasolina posto", "MATHEUS", "expense", 20_000, 2, "2026-11-09", 13),
  tx(3, "Aluguel novembro", "AMBOS", "expense", 150_000, 3, "2026-11-05"),
  tx(4, "Salário Ruth", "RUTH", "income", 300_000, 1, "2026-11-01", 11),
];

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

export const BILL_LUZ = bill(31, "Luz", "MATHEUS", "2026-11-15", 18_950);
export const BILL_INTERNET = bill(32, "Internet", "RUTH", "2026-11-05", 9990);

const goal = (g: Partial<Goal> & Pick<Goal, "id" | "owner" | "type" | "name" | "target_cents" | "progress">): Goal => ({
  active: true,
  ...g,
});

export const GOALS: Goal[] = [
  goal({
    id: 1,
    owner: "AMBOS",
    type: "accumulate",
    name: "Reserva de emergência",
    target_cents: 500_000,
    due_date: "2027-06-30",
    progress: { current_cents: 120_000, target_cents: 500_000, percent: 24, level: null },
  }),
  goal({
    id: 2,
    owner: "MATHEUS",
    type: "income_period",
    name: "Uber diário",
    target_cents: 13_000,
    period: "daily",
    linked_category_id: 15,
    levels: [
      { name: "Piso", target_cents: 10_000 },
      { name: "Meta", target_cents: 13_000 },
      { name: "Desafio", target_cents: 16_000 },
    ],
    progress: { current_cents: 11_000, target_cents: 13_000, percent: 84.62, level: "Piso" },
  }),
  goal({
    id: 3,
    owner: "RUTH",
    type: "category_cap",
    name: "iFood do mês",
    target_cents: 40_000,
    linked_category_id: 10,
    progress: { current_cents: 52_000, target_cents: 40_000, percent: 130, level: null },
  }),
  goal({
    id: 4,
    owner: "MATHEUS",
    type: "debt_payoff",
    name: "Quitar empréstimo",
    target_cents: 1_000_000,
    progress: { current_cents: 250_000, target_cents: 1_000_000, percent: 25, level: null },
  }),
];

export function canWriteServer(me: Me, owner: string) {
  return me.role === "admin" || owner === "AMBOS" || owner === me.owner;
}

/** Servidor simulado, com estado e as regras de permissão do contrato (403 para quem não pode). */
export function makeServer(me: Me, overrides: Record<string, Handler> = {}) {
  const state = {
    accounts: [...ACCOUNTS],
    transactions: [...TRANSACTIONS],
    upcoming: [BILL_LUZ],
    overdue: [BILL_INTERNET],
    goals: [...GOALS],
    nextId: 100,
  };

  const overview = (): Overview => {
    const groups = (["RUTH", "MATHEUS", "AMBOS"] as const).map((owner) => {
      const accounts = state.accounts.filter((a) => a.owner === owner);
      return { owner, accounts, total_cents: accounts.reduce((s, a) => s + a.current_balance_cents, 0) };
    });
    return {
      balances_by_owner: groups,
      couple_total_cents: groups.reduce((s, g) => s + g.total_cents, 0),
      open_card_invoices: [{ account_id: 4, account_name: "Cartão Nubank", open_amount_cents: 42_000, due_date: "2026-11-20" }],
      debts_balance_cents: 800_000,
      upcoming_bills: state.upcoming,
      overdue_bills: state.overdue,
    };
  };

  const body = <T,>(req: Request) => req.clone().json() as Promise<T>;
  const forbidden = () => json({ detail: "Você não pode alterar registros de outro usuário." }, 403);

  const routes: Record<string, Handler> = {
    "GET /auth/me": () => json(me),
    "GET /overview": () => json(overview()),
    "GET /accounts": () => json({ items: state.accounts, total: state.accounts.length }),
    "GET /categories": () => json({ items: CATEGORIES, total: CATEGORIES.length }),
    "POST /accounts": async (req) => {
      const b = await body<Partial<Account>>(req);
      if (!canWriteServer(me, b.owner ?? "")) return forbidden();
      const created = {
        ...b,
        id: state.nextId++,
        created_by: me.id,
        active: b.active ?? true,
        current_balance_cents: b.initial_balance_cents ?? 0,
      } as Account;
      state.accounts.push(created);
      return json(created, 201);
    },
    "PATCH /accounts/:id": async (req, p) => {
      const found = state.accounts.find((a) => a.id === Number(p.id));
      if (!found) return json({ detail: "Conta não encontrada." }, 404);
      if (!canWriteServer(me, found.owner)) return forbidden();
      Object.assign(found, await body<Partial<Account>>(req));
      return json(found);
    },
    "GET /transactions": (req) => {
      const q = new URL(req.url).searchParams;
      let items = state.transactions.filter((t) => {
        if (q.get("owner") && t.owner !== q.get("owner")) return false;
        if (q.get("account_id") && t.account_id !== Number(q.get("account_id"))) return false;
        if (q.get("category_id") && t.category_id !== Number(q.get("category_id"))) return false;
        if (q.get("kind") && t.kind !== q.get("kind")) return false;
        if (q.get("date_from") && t.date < q.get("date_from")!) return false;
        if (q.get("date_to") && t.date > q.get("date_to")!) return false;
        if (q.get("q") && !t.description.toLowerCase().startsWith(q.get("q")!.toLowerCase())) return false;
        return true;
      });
      const total = items.length;
      const offset = Number(q.get("offset") ?? 0);
      items = items.slice(offset, offset + Number(q.get("limit") ?? 50));
      return json({ items, total });
    },
    "PATCH /transactions/:id": async (req, p) => {
      const found = state.transactions.find((t) => t.id === Number(p.id));
      if (!found) return json({ detail: "Lançamento não encontrado." }, 404);
      if (!canWriteServer(me, found.owner)) return forbidden();
      Object.assign(found, await body<Partial<Transaction>>(req));
      return json(found);
    },
    "DELETE /transactions/:id": (_req, p) => {
      const found = state.transactions.find((t) => t.id === Number(p.id));
      if (!found) return json({ detail: "Lançamento não encontrado." }, 404);
      if (!canWriteServer(me, found.owner)) return forbidden();
      state.transactions = state.transactions.filter((t) => t.id !== found.id);
      return new Response(null, { status: 204 });
    },
    "POST /bill-instances/:id/pay": (_req, p) => {
      const id = Number(p.id);
      const found = [...state.upcoming, ...state.overdue].find((b) => b.id === id);
      if (!found) return json({ detail: "Instância não encontrada." }, 404);
      if (!canWriteServer(me, found.owner ?? "AMBOS")) return forbidden();
      state.upcoming = state.upcoming.filter((b) => b.id !== id);
      state.overdue = state.overdue.filter((b) => b.id !== id);
      return json({ ...found, status: "paid", paid_transaction_id: 500 });
    },
    "GET /goals": () => json({ items: state.goals, total: state.goals.length }),
    "POST /goals": async (req) => {
      const b = await body<Partial<Goal>>(req);
      if (!canWriteServer(me, b.owner ?? "")) return forbidden();
      const created = {
        ...b,
        id: state.nextId++,
        active: b.active ?? true,
        progress: { current_cents: 0, target_cents: b.target_cents ?? 0, percent: 0, level: null },
      } as Goal;
      state.goals.push(created);
      return json(created, 201);
    },
    "PATCH /goals/:id": async (req, p) => {
      const found = state.goals.find((g) => g.id === Number(p.id));
      if (!found) return json({ detail: "Meta não encontrada." }, 404);
      if (!canWriteServer(me, found.owner)) return forbidden();
      Object.assign(found, await body<Partial<Goal>>(req));
      return json(found);
    },
    "DELETE /goals/:id": (_req, p) => {
      const found = state.goals.find((g) => g.id === Number(p.id));
      if (!found) return json({ detail: "Meta não encontrada." }, 404);
      if (!canWriteServer(me, found.owner)) return forbidden();
      state.goals = state.goals.filter((g) => g.id !== found.id);
      return new Response(null, { status: 204 });
    },
    "POST /goals/:id/entries": async (req, p) => {
      const found = state.goals.find((g) => g.id === Number(p.id));
      if (!found) return json({ detail: "Meta não encontrada." }, 404);
      if (!canWriteServer(me, found.owner)) return forbidden();
      const b = await body<{ amount_cents: number; date: string }>(req);
      const current = found.progress.current_cents + b.amount_cents;
      found.progress = {
        ...found.progress,
        current_cents: current,
        percent: Math.round((current * 10_000) / found.progress.target_cents) / 100,
      };
      return json({ id: state.nextId++, goal_id: found.id, ...b }, 201);
    },
    ...overrides,
  };

  const calls = mockFetch(routes);
  return { state, calls };
}

/** Chamadas que gravam (tudo que não é GET). */
export const writes = (calls: Call[]) => calls.filter((c) => c.req.method !== "GET").map((c) => c.key);
export const bodyOf = async (calls: Call[], key: string) =>
  JSON.parse(await calls.find((c) => c.key === key)!.req.clone().text()) as Record<string, unknown>;
export const searchOf = (calls: Call[], key: string) => new URL(calls.filter((c) => c.key === key).at(-1)!.req.url).searchParams;

export function renderApp(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>{ui}</AuthProvider>
    </QueryClientProvider>,
  );
}
