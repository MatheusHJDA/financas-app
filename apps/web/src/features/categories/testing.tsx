// Apoio dos testes da tela de Categorias (não é importado pelo app): /categories com estado
// por cima do servidor simulado das outras telas.
import type { components } from "../../api/schema";
import { json, makeServer, type Handler } from "../../test/appTesting";

type Me = Parameters<typeof makeServer>[0];
type Category = components["schemas"]["Category"];

const cat = (id: number, name: string, kind: Category["kind"]): Category => ({
  id,
  name,
  kind,
  is_recurring_card_allowed: false,
});

export const START: Category[] = [
  cat(10, "Mercado", "expense"),
  cat(11, "Salário", "income"),
  cat(12, "Energia elétrica", "expense"),
  cat(15, "Uber", "income"),
];

export function makeCategoriesServer(me: Me, opts: { deleteConflict?: boolean } = {}) {
  const state = { items: [...START], nextId: 100 };
  const body = <T,>(req: Request) => req.clone().json() as Promise<T>;
  const routes: Record<string, Handler> = {
    "GET /categories": () => json({ items: state.items, total: state.items.length }),
    "POST /categories": async (req) => {
      const b = await body<{ name: string; kind: Category["kind"] }>(req);
      const created = { ...cat(state.nextId++, b.name, b.kind) };
      state.items = [...state.items, created];
      return json(created, 201);
    },
    "PATCH /categories/:id": async (req, p) => {
      const b = await body<{ name: string }>(req);
      state.items = state.items.map((c) => (c.id === Number(p.id) ? { ...c, name: b.name } : c));
      return json(state.items.find((c) => c.id === Number(p.id)));
    },
    "DELETE /categories/:id": (_req, p) => {
      if (opts.deleteConflict) return json({ detail: "A categoria está em uso." }, 409);
      state.items = state.items.filter((c) => c.id !== Number(p.id));
      return new Response(null, { status: 204 });
    },
  };
  return { ...makeServer(me, routes), state };
}
