// Apoio dos testes de Contas fixas (não é importado pelo app): servidor simulado de /recurring-bills
// por cima do servidor da tela Geral, com as regras de permissão do contrato.
import { ACCOUNTS, canWriteServer, json, makeServer, type Handler } from "../overview/testing";
import type { RecurringBill } from "./fixedBillForm";

export const FIXED_BILLS: RecurringBill[] = [
  {
    id: 1,
    owner: "AMBOS",
    name: "Condomínio",
    amount_cents: 18_000,
    due_day: 10,
    start_month: "2026-01-01",
    end_month: null,
    account_id: null,
    category_id: 12,
    payment_method: "Boleto",
  },
  {
    id: 2,
    owner: "MATHEUS",
    name: "Luz",
    amount_cents: 20_000,
    due_day: 5,
    start_month: "2026-01-01",
    end_month: null,
    account_id: 2,
    category_id: 12,
    payment_method: "Pix",
  },
  {
    id: 3,
    owner: "RUTH",
    name: "Internet",
    amount_cents: 8990,
    due_day: 20,
    start_month: "2026-01-01",
    end_month: "2099-12-01",
    account_id: 1,
    category_id: null,
    payment_method: null,
  },
  {
    id: 4,
    owner: "AMBOS",
    name: "Seguro antigo",
    amount_cents: 50_000,
    due_day: 15,
    start_month: "2019-01-01",
    end_month: "2020-01-01",
    account_id: 3,
    category_id: null,
    payment_method: null,
  },
];

type Me = Parameters<typeof makeServer>[0];

/** Servidor da tela Geral + /recurring-bills com estado. `conflictIds`: DELETE devolve 409 (já há pagamento). */
export function makeBillsServer(me: Me, opts: { bills?: RecurringBill[]; conflictIds?: number[] } = {}) {
  const bills = (opts.bills ?? FIXED_BILLS).map((b) => ({ ...b }));
  const state = { bills, nextId: 900 };
  const body = <T,>(req: Request) => req.clone().json() as Promise<T>;
  const forbidden = () => json({ detail: "Você não pode alterar registros de outro usuário." }, 403);

  // Servidor real: a conta bancária só pode ser uma que o usuário movimenta (D6).
  const accountForbidden = (accountId: number | null | undefined) => {
    if (accountId == null) return false;
    const account = ACCOUNTS.find((a) => a.id === accountId);
    return !!account && !canWriteServer(me, account.owner);
  };

  const routes: Record<string, Handler> = {
    "GET /recurring-bills": () => json({ items: state.bills, total: state.bills.length }),
    "POST /recurring-bills": async (req) => {
      const b = await body<Partial<RecurringBill>>(req);
      if (!canWriteServer(me, b.owner ?? "") || accountForbidden(b.account_id)) return forbidden();
      const created = { end_month: null, account_id: null, category_id: null, payment_method: null, ...b, id: state.nextId++ } as RecurringBill;
      state.bills.push(created);
      return json(created, 201);
    },
    "PATCH /recurring-bills/:id": async (req, p) => {
      const found = state.bills.find((b) => b.id === Number(p.id));
      if (!found) return json({ detail: "Conta fixa não encontrada." }, 404);
      if (!canWriteServer(me, found.owner)) return forbidden();
      const patch = await body<Partial<RecurringBill>>(req);
      if (accountForbidden(patch.account_id)) return forbidden();
      Object.assign(found, patch);
      return json(found);
    },
    "DELETE /recurring-bills/:id": (_req, p) => {
      const found = state.bills.find((b) => b.id === Number(p.id));
      if (!found) return json({ detail: "Conta fixa não encontrada." }, 404);
      if (!canWriteServer(me, found.owner)) return forbidden();
      if (opts.conflictIds?.includes(found.id)) {
        return json(
          {
            detail:
              "Esta conta fixa já tem pagamentos registrados. Para parar de cobrá-la, defina o mês final (end_month) em vez de excluir.",
          },
          409,
        );
      }
      state.bills = state.bills.filter((b) => b.id !== found.id);
      return new Response(null, { status: 204 });
    },
  };

  const server = makeServer(me, routes);
  return { ...server, bills: state };
}
