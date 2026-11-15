// Apoio dos testes de Transações (não é importado pelo app): API simulada com estado,
// dois usuários (Ruth = member, Matheus = admin) e render com os provedores.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import type { components } from "../../api/schema";
import { AuthProvider } from "../../auth/AuthProvider";

type Me = components["schemas"]["Me"];
type Account = components["schemas"]["Account"];
type Category = components["schemas"]["Category"];
type Transaction = components["schemas"]["Transaction"];

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

export const tx = (
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

export function canWriteServer(me: Me, owner: string) {
  return me.role === "admin" || owner === "AMBOS" || owner === me.owner;
}

/** Servidor simulado, com estado e as regras de permissão do contrato (403 para quem não pode). */
export function makeServer(me: Me, overrides: Record<string, Handler> = {}, initial: Transaction[] = TRANSACTIONS) {
  const state = {
    accounts: [...ACCOUNTS],
    transactions: initial.map((t) => ({ ...t })), // cópia: PATCH muda o objeto e não pode vazar entre testes
  };

  const body = <T,>(req: Request) => req.clone().json() as Promise<T>;
  const forbidden = () => json({ detail: "Você não pode alterar registros de outro usuário." }, 403);

  const routes: Record<string, Handler> = {
    "GET /auth/me": () => json(me),
    "GET /accounts": () => json({ items: state.accounts, total: state.accounts.length }),
    "GET /categories": () => json({ items: CATEGORIES, total: CATEGORIES.length }),
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
