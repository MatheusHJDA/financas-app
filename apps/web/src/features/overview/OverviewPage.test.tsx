import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { todayIso } from "../chat/dates";
import OverviewPage from "./OverviewPage";
import { bodyOf, json, makeServer, MATHEUS, renderApp, RUTH, searchOf, writes } from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const row = (text: string) => screen.getByText(text).closest("li") as HTMLElement;
const editBtn = (name: string) => screen.queryByRole("button", { name: `Editar ${name}` });
const deleteBtn = (name: string) => screen.queryByRole("button", { name: `Excluir ${name}` });

async function openAs(me: typeof RUTH, overrides = {}) {
  const server = makeServer(me, overrides);
  renderApp(<OverviewPage />);
  await screen.findByText("Supermercado BH");
  return server;
}

it("mostra saldos por dono, total do casal, faturas e saldo devedor", async () => {
  await openAs(RUTH);
  const ruth = await screen.findByRole("group", { name: "Saldos de Ruth" });
  expect(within(ruth).getByText("Nubank Ruth")).toBeTruthy();
  expect(within(ruth).getByText("Total de Ruth")).toBeTruthy();
  expect(within(ruth).getByText("R$ 1.080,00")).toBeTruthy(); // 1.500 − 420
  expect(screen.getByText("Total do casal")).toBeTruthy();
  expect(screen.getByText("R$ 9.080,00")).toBeTruthy(); // 1.500 + 3.000 + 5.000 − 420
  const invoices = screen.getByRole("group", { name: "Faturas abertas dos cartões" });
  expect(within(invoices).getByText("R$ 420,00")).toBeTruthy();
  expect(within(invoices).getByText(/vence em 20\/11\/2026/)).toBeTruthy();
  expect(screen.getByText("Saldo devedor das dívidas")).toBeTruthy();
  expect(screen.getByText("R$ 8.000,00")).toBeTruthy();
});

it("Ruth: editar/excluir só nos lançamentos dela e nos AMBOS; nunca no do Matheus", async () => {
  await openAs(RUTH);
  await waitFor(() => expect(editBtn("Supermercado BH")).toBeTruthy());
  expect(deleteBtn("Supermercado BH")).toBeTruthy();
  expect(editBtn("Salário Ruth")).toBeTruthy();
  expect(editBtn("Aluguel novembro")).toBeTruthy(); // AMBOS
  expect(deleteBtn("Aluguel novembro")).toBeTruthy();
  expect(editBtn("Gasolina posto")).toBeNull(); // MATHEUS
  expect(deleteBtn("Gasolina posto")).toBeNull();
});

it("Matheus (admin): editar/excluir em todos os lançamentos", async () => {
  await openAs(MATHEUS);
  await waitFor(() => expect(editBtn("Gasolina posto")).toBeTruthy());
  for (const name of ["Supermercado BH", "Gasolina posto", "Aluguel novembro", "Salário Ruth"]) {
    expect(editBtn(name)).toBeTruthy();
    expect(deleteBtn(name)).toBeTruthy();
  }
});

it("filtros Ruth/Matheus/Ambos mandam o parâmetro certo e mostram só o devido", async () => {
  const { calls } = await openAs(RUTH);
  expect(searchOf(calls, "GET /transactions").get("owner")).toBeNull();

  fireEvent.click(screen.getByRole("radio", { name: "Ruth" }));
  await waitFor(() => expect(searchOf(calls, "GET /transactions").get("owner")).toBe("RUTH"));
  await waitFor(() => expect(screen.queryByText("Gasolina posto")).toBeNull());
  expect(screen.getByText("Supermercado BH")).toBeTruthy();
  expect(screen.getByText("Salário Ruth")).toBeTruthy();
  expect(screen.queryByText("Aluguel novembro")).toBeNull();

  fireEvent.click(screen.getByRole("radio", { name: "Matheus" }));
  await waitFor(() => expect(searchOf(calls, "GET /transactions").get("owner")).toBe("MATHEUS"));
  await screen.findByText("Gasolina posto");
  expect(screen.queryByText("Supermercado BH")).toBeNull();

  fireEvent.click(screen.getByRole("radio", { name: "Ambos" }));
  await waitFor(() => expect(searchOf(calls, "GET /transactions").get("owner")).toBe("AMBOS"));
  await screen.findByText("Aluguel novembro");
  expect(screen.queryByText("Gasolina posto")).toBeNull();

  fireEvent.click(screen.getByRole("radio", { name: "Todos" }));
  await waitFor(() => expect(searchOf(calls, "GET /transactions").get("owner")).toBeNull());
  await screen.findByText("Gasolina posto");
});

it("conta, categoria, tipo, período e busca viram parâmetros; o CSV leva os mesmos filtros", async () => {
  const { calls } = await openAs(RUTH);
  fireEvent.click(screen.getByRole("radio", { name: "Ruth" }));
  fireEvent.change(screen.getByLabelText("Conta"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "expense" } });
  fireEvent.change(screen.getByLabelText("De (data)"), { target: { value: "2026-11-01" } });
  fireEvent.change(screen.getByLabelText("Até (data)"), { target: { value: "2026-11-30" } });
  fireEvent.change(screen.getByLabelText("Buscar na descrição"), { target: { value: "Super" } });
  fireEvent.click(screen.getByRole("button", { name: "Buscar" }));

  await waitFor(() => expect(searchOf(calls, "GET /transactions").get("q")).toBe("Super"));
  const s = searchOf(calls, "GET /transactions");
  expect(Object.fromEntries(s)).toEqual({
    owner: "RUTH",
    account_id: "1",
    category_id: "10",
    kind: "expense",
    date_from: "2026-11-01",
    date_to: "2026-11-30",
    q: "Super",
    limit: "20",
    offset: "0",
  });
  const link = screen.getByRole("link", { name: "Exportar CSV" });
  expect(link.getAttribute("href")).toBe(
    "/api/transactions/export.csv?owner=RUTH&account_id=1&category_id=10&kind=expense&date_from=2026-11-01&date_to=2026-11-30&q=Super",
  );
  await waitFor(() => expect(screen.queryByText("Gasolina posto")).toBeNull());
  expect(screen.getByText("Supermercado BH")).toBeTruthy();
});

it("sem filtros o link do CSV não leva parâmetros", async () => {
  await openAs(RUTH);
  expect(screen.getByRole("link", { name: "Exportar CSV" }).getAttribute("href")).toBe("/api/transactions/export.csv");
});

it("edita um lançamento: '1.234,56' vira 123456 centavos", async () => {
  const { calls } = await openAs(RUTH);
  await waitFor(() => expect(editBtn("Supermercado BH")).toBeTruthy());
  fireEvent.click(editBtn("Supermercado BH")!);
  const amount = screen.getByLabelText("Valor (R$)");
  expect((amount as HTMLInputElement).value).toBe("45,90");
  fireEvent.change(amount, { target: { value: "1.234,56" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar lançamento" }));

  await waitFor(() => expect(writes(calls)).toContain("PATCH /transactions/1"));
  const body = await bodyOf(calls, "PATCH /transactions/1");
  expect(body.amount_cents).toBe(123456);
  expect(body.owner).toBe("RUTH");
  await screen.findByText("R$ 1.234,56", { exact: false });
});

it("valor inválido na edição não chama a API", async () => {
  const { calls } = await openAs(RUTH);
  await waitFor(() => expect(editBtn("Supermercado BH")).toBeTruthy());
  fireEvent.click(editBtn("Supermercado BH")!);
  fireEvent.change(screen.getByLabelText("Valor (R$)"), { target: { value: "abc" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar lançamento" }));
  expect(await screen.findByText(/Informe um valor maior que zero/)).toBeTruthy();
  expect(writes(calls)).toEqual([]);
});

it("403 do servidor ao editar mostra 'Você não pode alterar esse lançamento.'", async () => {
  await openAs(RUTH, { "PATCH /transactions/:id": () => json({ detail: "x" }, 403) });
  await waitFor(() => expect(editBtn("Supermercado BH")).toBeTruthy());
  fireEvent.click(editBtn("Supermercado BH")!);
  fireEvent.click(screen.getByRole("button", { name: "Salvar lançamento" }));
  expect(await screen.findByText("Você não pode alterar esse lançamento.")).toBeTruthy();
});

it("excluir só grava depois da confirmação; 403 mostra a mensagem", async () => {
  const { calls } = await openAs(RUTH);
  await waitFor(() => expect(deleteBtn("Supermercado BH")).toBeTruthy());

  fireEvent.click(deleteBtn("Supermercado BH")!);
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(writes(calls)).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(writes(calls)).toEqual([]);

  fireEvent.click(deleteBtn("Supermercado BH")!);
  fireEvent.click(screen.getByRole("button", { name: "Sim, excluir" }));
  await waitFor(() => expect(writes(calls)).toEqual(["DELETE /transactions/1"]));
  await waitFor(() => expect(screen.queryByText("Supermercado BH")).toBeNull());
});

it("excluir com 403 do servidor mostra a mensagem de permissão", async () => {
  await openAs(RUTH, { "DELETE /transactions/:id": () => json({ detail: "x" }, 403) });
  await waitFor(() => expect(deleteBtn("Supermercado BH")).toBeTruthy());
  fireEvent.click(deleteBtn("Supermercado BH")!);
  fireEvent.click(screen.getByRole("button", { name: "Sim, excluir" }));
  expect(await screen.findByText("Você não pode alterar esse lançamento.")).toBeTruthy();
  expect(screen.getByText("Supermercado BH")).toBeTruthy();
});

it("paginação: 20 por página e botões Anterior/Próxima", async () => {
  const many = Array.from({ length: 25 }, (_v, i) => ({
    id: 200 + i,
    kind: "expense" as const,
    amount_cents: 1000 + i,
    date: "2026-11-01",
    description: `Item ${String(i).padStart(2, "0")}`,
    account_id: 1,
    owner: "RUTH" as const,
    created_by: 2,
    status: "confirmed" as const,
    source: "manual" as const,
  }));
  const { calls } = makeServer(RUTH, {
    "GET /transactions": (req) => {
      const q = new URL(req.url).searchParams;
      const offset = Number(q.get("offset") ?? 0);
      return json({ items: many.slice(offset, offset + Number(q.get("limit") ?? 50)), total: many.length });
    },
  });
  renderApp(<OverviewPage />);
  await screen.findByText("Item 00");
  expect(screen.getByText("Mostrando 1–20 de 25")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
  await screen.findByText("Item 20");
  expect(screen.getByText("Mostrando 21–25 de 25")).toBeTruthy();
  expect(searchOf(calls, "GET /transactions").get("offset")).toBe("20");
  expect(screen.queryByText("Item 00")).toBeNull();
});

it("estado vazio e erro da lista de movimentações", async () => {
  makeServer(RUTH, { "GET /transactions": () => json({ items: [], total: 0 }) });
  renderApp(<OverviewPage />);
  expect(await screen.findByText("Nenhuma movimentação")).toBeTruthy();
  cleanup();

  makeServer(RUTH, { "GET /transactions": () => json({ detail: "falha" }, 500) });
  renderApp(<OverviewPage />);
  expect(await screen.findByText("Não foi possível carregar as movimentações.")).toBeTruthy();
});

// --- Contas a pagar ---

it("Marcar como paga só grava após a confirmação (POST sem corpo)", async () => {
  const { calls } = await openAs(MATHEUS);
  const luz = row("Luz");
  expect(within(luz).getByText("Matheus · vence em 15/11/2026")).toBeTruthy();
  expect(within(luz).getByText("R$ 189,50")).toBeTruthy();

  fireEvent.click(within(luz).getByRole("button", { name: "Marcar como paga" }));
  expect(screen.getByText("Marcar Luz como paga?")).toBeTruthy();
  expect(writes(calls)).toEqual([]);

  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByText("Marcar Luz como paga?")).toBeNull();
  expect(writes(calls)).toEqual([]);

  fireEvent.click(within(row("Luz")).getByRole("button", { name: "Marcar como paga" }));
  fireEvent.click(screen.getByRole("button", { name: "Sim, marcar como paga" }));
  await waitFor(() => expect(writes(calls)).toEqual(["POST /bill-instances/31/pay"]));
  const call = calls.find((c) => c.key === "POST /bill-instances/31/pay")!;
  expect(await call.req.clone().text()).toBe("");
  await waitFor(() => expect(screen.queryByText("Marcar Luz como paga?")).toBeNull());
  await waitFor(() => expect(screen.queryByText("Luz")).toBeNull());
  expect(screen.getByText("Luz marcada como paga.")).toBeTruthy();
});

it("conta vencida aparece marcada e só o dono (ou admin) vê o botão", async () => {
  await openAs(RUTH);
  const overdue = screen.getByRole("group", { name: "Contas vencidas" });
  expect(within(overdue).getByText("Internet")).toBeTruthy();
  expect(within(overdue).getByText("Vencida")).toBeTruthy();
  expect(within(overdue).getByRole("button", { name: "Marcar como paga" })).toBeTruthy(); // dela
  const upcoming = screen.getByRole("group", { name: "Próximos 15 dias" });
  expect(within(upcoming).getByText("Luz")).toBeTruthy();
  expect(within(upcoming).queryByRole("button", { name: "Marcar como paga" })).toBeNull(); // do Matheus
});

it("422 (conta fixa sem conta bancária) mostra o detail e manda lançar pelo chat", async () => {
  const detail = "A conta não tem conta bancária associada; informe transaction_id.";
  await openAs(MATHEUS, { "POST /bill-instances/:id/pay": () => json({ detail }, 422) });
  fireEvent.click(within(row("Luz")).getByRole("button", { name: "Marcar como paga" }));
  fireEvent.click(screen.getByRole("button", { name: "Sim, marcar como paga" }));
  const alert = await screen.findByText(/não tem conta bancária associada/);
  expect(alert.textContent).toContain(detail);
  expect(alert.textContent).toContain("Lance o pagamento pelo chat");
  expect(screen.queryByRole("button", { name: "Sim, marcar como paga" })).toBeNull();
  expect(screen.getByRole("button", { name: "Fechar" })).toBeTruthy();
});

// --- Contas ---

it("Ruth cria uma conta (R$ vira centavos) e um lançamento nessa conta aparece com editar/excluir", async () => {
  const { calls, state } = await openAs(RUTH);
  const create = await screen.findByRole("button", { name: "Nova conta" });
  fireEvent.click(create);
  fireEvent.change(screen.getByLabelText("Nome da conta"), { target: { value: "Carteira" } });
  fireEvent.change(screen.getByLabelText("Saldo inicial (R$)"), { target: { value: "1.234,56" } });
  fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));

  await waitFor(() => expect(writes(calls)).toContain("POST /accounts"));
  expect(await bodyOf(calls, "POST /accounts")).toMatchObject({
    owner: "RUTH",
    name: "Carteira",
    type: "checking",
    initial_balance_cents: 123456,
    initial_balance_date: todayIso(),
    closing_day: null,
    due_day: null,
  });
  await screen.findByText("Conta criada.");
  expect((await screen.findAllByText("Carteira")).length).toBeGreaterThan(0);

  // lançamento feito pelo chat na conta nova (simulado no servidor)
  const account = state.accounts.at(-1)!;
  state.transactions.unshift({
    id: 900,
    kind: "expense",
    amount_cents: 1500,
    date: "2026-11-12",
    description: "Pastel da feira",
    account_id: account.id,
    owner: "RUTH",
    created_by: 2,
    status: "confirmed",
    source: "chat",
  });
  fireEvent.click(screen.getByRole("radio", { name: "Ruth" }));
  await screen.findByText("Pastel da feira");
  expect(editBtn("Pastel da feira")).toBeTruthy();
  expect(deleteBtn("Pastel da feira")).toBeTruthy();
});

it("Ruth só vê para editar as contas dela e as de AMBOS", async () => {
  await openAs(RUTH);
  await screen.findByRole("button", { name: "Editar conta Nubank Ruth" });
  expect(screen.getByRole("button", { name: "Editar conta Reserva casal" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Editar conta Itaú Matheus" })).toBeNull();
});

it("empréstimo: explica saldo negativo e conta em um lugar só; saldo positivo é recusado", async () => {
  const { calls } = await openAs(RUTH);
  fireEvent.click(await screen.findByRole("button", { name: "Nova conta" }));
  fireEvent.change(screen.getByLabelText("Tipo da conta"), { target: { value: "loan" } });
  expect(screen.getByText(/o saldo é/).textContent).toMatch(/negativo/);
  expect(screen.getByText(/lugar só/)).toBeTruthy();

  fireEvent.change(screen.getByLabelText("Nome da conta"), { target: { value: "Empréstimo Caixa" } });
  fireEvent.change(screen.getByLabelText("Saldo inicial (negativo, R$)"), { target: { value: "5.000,00" } });
  fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
  expect(await screen.findByText(/informe o saldo negativo/)).toBeTruthy();
  expect(writes(calls)).toEqual([]);

  fireEvent.change(screen.getByLabelText("Saldo inicial (negativo, R$)"), { target: { value: "-5.000,00" } });
  fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
  await waitFor(() => expect(writes(calls)).toEqual(["POST /accounts"]));
  expect((await bodyOf(calls, "POST /accounts")).initial_balance_cents).toBe(-500000);
});
