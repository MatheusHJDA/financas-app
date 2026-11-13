import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activeTotalCents, currentMonth, startsLater, type RecurringBill } from "./fixedBillForm";
import OverviewPage from "../overview/OverviewPage";
import { bodyOf, MATHEUS, renderApp, RUTH, writes } from "../overview/testing";
import { FixedBillsSection } from "./FixedBillsSection";
import { FIXED_BILLS, makeBillsServer } from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Options = Parameters<typeof makeBillsServer>[1];

async function openAs(me: typeof RUTH, opts: Options = {}) {
  const server = makeBillsServer(me, opts);
  renderApp(<FixedBillsSection />);
  await screen.findByText("Condomínio");
  return server;
}

const item = (name: string) => screen.getByText(name).closest("li") as HTMLElement;
const btn = (verb: string, name: string) => screen.queryByRole("button", { name: `${verb} ${name}` });
const click = (verb: string, name: string) => fireEvent.click(screen.getByRole("button", { name: `${verb} ${name}` }));
const field = (form: HTMLElement, label: string) => within(form).getByLabelText(label) as HTMLInputElement;
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

async function waitForEdit(name: string) {
  await waitFor(() => expect(btn("Editar", name)).toBeTruthy());
}

it("lista por dia de vencimento, com detalhes, e soma só as ativas", async () => {
  await openAs(MATHEUS);
  const names = screen.getAllByRole("listitem").map((li) => li.querySelector("strong")?.textContent);
  expect(names).toEqual(["Luz", "Condomínio", "Seguro antigo", "Internet"]); // dias 5, 10, 15, 20
  const luz = within(item("Luz"));
  expect(luz.getByText("R$ 200,00")).toBeTruthy();
  expect(luz.getByText(/vence dia 5/)).toBeTruthy();
  expect(luz.getByText(/Conta: Itaú Matheus/)).toBeTruthy();
  expect(luz.getByText(/Energia elétrica/)).toBeTruthy();
  expect(luz.getByText(/Pix/)).toBeTruthy();
  expect(within(item("Internet")).getByText(/encerra em 12\/2099/)).toBeTruthy();
  expect(within(item("Seguro antigo")).getByText("Encerrada em 01/2020")).toBeTruthy();
  // 180,00 + 200,00 + 89,90 (o "Seguro antigo" já encerrou e não entra)
  expect(screen.getByText("Total mensal (inclui as que começam nos próximos meses)")).toBeTruthy();
  expect(screen.getByText("R$ 469,90")).toBeTruthy();
});

it("destaca conta fixa sem conta bancária e explica o efeito", async () => {
  await openAs(MATHEUS);
  const cond = within(item("Condomínio"));
  expect(cond.getByText("Sem conta bancária")).toBeTruthy();
  expect(cond.getByText(/Marcar como paga/)).toBeTruthy();
  expect(within(item("Luz")).queryByText("Sem conta bancária")).toBeNull();
});

it("editar só o dia de vencimento envia PATCH {due_day}", async () => {
  const { calls, bills } = await openAs(MATHEUS);
  await waitForEdit("Luz");
  click("Editar", "Luz");
  const form = screen.getByRole("form", { name: "Editar conta fixa Luz" });
  expect(field(form, "Valor mensal (R$)").value).toBe("200,00");
  expect(within(form).getByText(/último dia do mês/)).toBeTruthy(); // aviso dos dias 29–31
  type(field(form, "Dia do vencimento (1 a 31)"), "15");
  fireEvent.click(within(form).getByRole("button", { name: "Salvar conta fixa" }));
  await waitFor(() => expect(writes(calls)).toEqual(["PATCH /recurring-bills/2"]));
  expect(await bodyOf(calls, "PATCH /recurring-bills/2")).toEqual({ due_day: 15 });
  expect(bills.bills.find((b) => b.id === 2)?.due_day).toBe(15);
  await screen.findByText("Luz atualizada.");
  // Depois de gravar, recarrega a lista e a visão geral.
  await waitFor(() => expect(calls.filter((c) => c.key === "GET /recurring-bills").length).toBeGreaterThan(1));
});

it("valor '1.234,56' vira 123456 centavos", async () => {
  const { calls } = await openAs(MATHEUS);
  await waitForEdit("Luz");
  click("Editar", "Luz");
  const form = screen.getByRole("form", { name: "Editar conta fixa Luz" });
  type(field(form, "Valor mensal (R$)"), "1.234,56");
  fireEvent.click(within(form).getByRole("button", { name: "Salvar conta fixa" }));
  await waitFor(() => expect(writes(calls)).toEqual(["PATCH /recurring-bills/2"]));
  expect(await bodyOf(calls, "PATCH /recurring-bills/2")).toEqual({ amount_cents: 123_456 });
});

it("valor inválido, zero ou negativo não grava e mostra o erro", async () => {
  const { calls } = await openAs(MATHEUS);
  await waitForEdit("Luz");
  click("Editar", "Luz");
  const form = screen.getByRole("form", { name: "Editar conta fixa Luz" });
  for (const bad of ["0", "-5,00", "abc"]) {
    type(field(form, "Valor mensal (R$)"), bad);
    fireEvent.click(within(form).getByRole("button", { name: "Salvar conta fixa" }));
    expect((await within(form).findByRole("alert")).textContent).toMatch(/maior que zero/);
  }
  type(field(form, "Dia do vencimento (1 a 31)"), "32");
  fireEvent.click(within(form).getByRole("button", { name: "Salvar conta fixa" }));
  await within(form).findByText("Informe um dia de 1 a 31.");
  expect(writes(calls)).toEqual([]);
});

it("trocar a conta bancária e limpar a forma de pagamento envia só esses campos", async () => {
  const { calls } = await openAs(MATHEUS);
  await waitForEdit("Condomínio");
  click("Editar", "Condomínio");
  const form = screen.getByRole("form", { name: "Editar conta fixa Condomínio" });
  type(field(form, "Conta bancária (de onde sai o pagamento)"), "3");
  type(field(form, "Forma de pagamento (opcional)"), "");
  fireEvent.click(within(form).getByRole("button", { name: "Salvar conta fixa" }));
  await waitFor(() => expect(writes(calls)).toEqual(["PATCH /recurring-bills/1"]));
  expect(await bodyOf(calls, "PATCH /recurring-bills/1")).toEqual({ account_id: 3, payment_method: null });
});

it("sem mudança nenhuma, Salvar não chama a API", async () => {
  const { calls } = await openAs(MATHEUS);
  await waitForEdit("Luz");
  click("Editar", "Luz");
  const form = screen.getByRole("form", { name: "Editar conta fixa Luz" });
  fireEvent.click(within(form).getByRole("button", { name: "Salvar conta fixa" }));
  await waitFor(() => expect(screen.queryByRole("form", { name: "Editar conta fixa Luz" })).toBeNull());
  expect(writes(calls)).toEqual([]);
});

it("Ruth: o seletor de conta não mostra a conta do Matheus nem categoria de receita", async () => {
  await openAs(RUTH);
  await waitForEdit("Condomínio");
  click("Editar", "Condomínio");
  const form = screen.getByRole("form", { name: "Editar conta fixa Condomínio" });
  const accounts = within(field(form, "Conta bancária (de onde sai o pagamento)")).getAllByRole("option").map((o) => o.textContent);
  expect(accounts).toEqual([
    "Sem conta bancária",
    "Nubank Ruth (Ruth)",
    "Reserva casal (Ambos)",
    "Cartão Nubank (Ruth)",
  ]);
  expect(within(form).queryByText(/Itaú Matheus/)).toBeNull();
  const categories = within(field(form, "Categoria")).getAllByRole("option").map((o) => o.textContent);
  expect(categories).toEqual(["Sem categoria", "Mercado", "Energia elétrica", "Combustível"]);
  const owners = within(field(form, "Dono")).getAllByRole("option").map((o) => o.textContent);
  expect(owners).toEqual(["Ruth", "Ambos"]);
});

it("Matheus (admin) vê todas as contas no seletor", async () => {
  await openAs(MATHEUS);
  await waitForEdit("Condomínio");
  click("Editar", "Condomínio");
  const form = screen.getByRole("form", { name: "Editar conta fixa Condomínio" });
  const accounts = within(field(form, "Conta bancária (de onde sai o pagamento)")).getAllByRole("option");
  expect(accounts).toHaveLength(5); // sem conta + 4
});

it("Ruth não vê editar, encerrar nem excluir na conta fixa do Matheus", async () => {
  await openAs(RUTH);
  await waitForEdit("Condomínio");
  for (const verb of ["Editar", "Encerrar", "Excluir", "Reativar"]) expect(btn(verb, "Luz")).toBeNull();
  for (const verb of ["Editar", "Encerrar", "Excluir"]) {
    expect(btn(verb, "Condomínio")).toBeTruthy(); // AMBOS
    expect(btn(verb, "Internet")).toBeTruthy(); // dela
  }
});

it("403 do servidor mostra 'Você não pode alterar essa conta fixa.'", async () => {
  // Ruth tenta ficar com a conta do Matheus por uma conta fixa que o servidor recusa.
  const { calls } = await openAs(RUTH);
  await waitForEdit("Internet");
  click("Editar", "Internet");
  const form = screen.getByRole("form", { name: "Editar conta fixa Internet" });
  // Força um valor que não está nas opções: o servidor simulado responde 403.
  const select = field(form, "Conta bancária (de onde sai o pagamento)");
  const option = document.createElement("option");
  option.value = "2";
  option.textContent = "teste";
  select.appendChild(option);
  type(select, "2");
  fireEvent.click(within(form).getByRole("button", { name: "Salvar conta fixa" }));
  expect((await within(form).findByRole("alert")).textContent).toBe("Você não pode alterar essa conta fixa.");
  expect(writes(calls)).toEqual(["PATCH /recurring-bills/3"]);
});

it("excluir: pede confirmação, nada é gravado antes, e depois remove", async () => {
  const { calls } = await openAs(MATHEUS);
  await waitForEdit("Luz");
  click("Excluir", "Luz");
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(writes(calls)).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(writes(calls)).toEqual([]);

  click("Excluir", "Luz");
  fireEvent.click(screen.getByRole("button", { name: "Sim, excluir" }));
  await waitFor(() => expect(writes(calls)).toEqual(["DELETE /recurring-bills/2"]));
  await waitFor(() => expect(screen.queryByText("Luz")).toBeNull());
});

it("excluir com 409 mostra o detail e oferece Encerrar no lugar", async () => {
  const { calls } = await openAs(MATHEUS, { conflictIds: [2] });
  await waitForEdit("Luz");
  click("Excluir", "Luz");
  fireEvent.click(screen.getByRole("button", { name: "Sim, excluir" }));
  const dialog = await screen.findByRole("alertdialog");
  await within(dialog).findByText(/já tem pagamentos registrados/);
  expect(within(dialog).queryByRole("button", { name: "Sim, excluir" })).toBeNull(); // não adianta repetir
  expect(writes(calls)).toEqual(["DELETE /recurring-bills/2"]);

  fireEvent.click(screen.getByRole("button", { name: "Encerrar Luz" }));
  // Agora o painel de encerrar: campo de mês com o mês corrente.
  const month = (await screen.findByLabelText("Último mês cobrado")) as HTMLInputElement;
  expect(month.value).toBe(currentMonth());
  expect(screen.queryByText(/já tem pagamentos registrados/)).toBeNull();
});

it("encerrar envia end_month no primeiro dia do mês, só depois da confirmação", async () => {
  const { calls } = await openAs(MATHEUS);
  await waitForEdit("Luz");
  click("Encerrar", "Luz");
  type(screen.getByLabelText("Último mês cobrado"), "2027-02");
  expect(screen.getByText("Encerrar Luz em 02/2027?")).toBeTruthy();
  expect(writes(calls)).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Sim, encerrar" }));
  await waitFor(() => expect(writes(calls)).toEqual(["PATCH /recurring-bills/2"]));
  expect(await bodyOf(calls, "PATCH /recurring-bills/2")).toEqual({ end_month: "2027-02-01" });
  await screen.findByText(/encerra em 02\/2027/);
});

it("encerrar antes do mês de início é recusado no app", async () => {
  const { calls } = await openAs(MATHEUS);
  await waitForEdit("Luz");
  click("Encerrar", "Luz");
  type(screen.getByLabelText("Último mês cobrado"), "2025-12");
  expect((await screen.findByRole("alert")).textContent).toMatch(/não pode ser anterior ao início \(01\/2026\)/);
  expect(screen.queryByRole("button", { name: "Sim, encerrar" })).toBeNull();
  expect(writes(calls)).toEqual([]);
});

it("reativar envia end_month null, com confirmação", async () => {
  const { calls } = await openAs(MATHEUS);
  await waitForEdit("Internet");
  click("Reativar", "Internet");
  expect(writes(calls)).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Sim, reativar" }));
  await waitFor(() => expect(writes(calls)).toEqual(["PATCH /recurring-bills/3"]));
  expect(await bodyOf(calls, "PATCH /recurring-bills/3")).toEqual({ end_month: null });
});

it("nova conta fixa: mês de início padrão é o corrente e o valor vira centavos", async () => {
  const { calls } = await openAs(RUTH);
  fireEvent.click(screen.getByRole("button", { name: "Nova conta fixa" }));
  const form = await screen.findByRole("form", { name: "Nova conta fixa" });
  expect(field(form, "Mês de início").value).toBe(currentMonth());
  expect(field(form, "Dono").value).toBe("RUTH");
  type(field(form, "Nome da conta fixa"), "Streaming");
  type(field(form, "Valor mensal (R$)"), "39,90");
  type(field(form, "Dia do vencimento (1 a 31)"), "31");
  type(field(form, "Conta bancária (de onde sai o pagamento)"), "1");
  fireEvent.click(within(form).getByRole("button", { name: "Criar conta fixa" }));
  await waitFor(() => expect(writes(calls)).toEqual(["POST /recurring-bills"]));
  expect(await bodyOf(calls, "POST /recurring-bills")).toEqual({
    owner: "RUTH",
    name: "Streaming",
    amount_cents: 3990,
    due_day: 31,
    start_month: `${currentMonth()}-01`,
    account_id: 1,
  });
  await screen.findByText("Streaming");
});

it("abrir e cancelar os formulários não grava nada", async () => {
  const { calls } = await openAs(MATHEUS);
  await waitForEdit("Luz");
  click("Editar", "Luz");
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  click("Encerrar", "Luz");
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  fireEvent.click(screen.getByRole("button", { name: "Nova conta fixa" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(writes(calls)).toEqual([]);
});

it("lista vazia mostra o estado vazio e o botão de criar", async () => {
  makeBillsServer(MATHEUS, { bills: [] });
  renderApp(<FixedBillsSection />);
  await screen.findByText("Nenhuma conta fixa");
  expect(screen.getByRole("button", { name: "Nova conta fixa" })).toBeTruthy();
});

it("falha ao carregar mostra erro com 'Tentar de novo'", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "x" }), { status: 500 })));
  renderApp(<FixedBillsSection />);
  await screen.findByText("Não foi possível carregar as contas fixas.");
  expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
});

it("a tela Geral traz a seção Contas fixas logo depois de Contas a pagar", async () => {
  makeBillsServer(MATHEUS);
  renderApp(<OverviewPage />);
  await screen.findByText("Condomínio");
  const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(headings.indexOf("Contas fixas")).toBe(headings.indexOf("Contas a pagar") + 1);
  expect(screen.getByRole("link", { name: /Ajustar as contas fixas/ }).getAttribute("href")).toBe("#contas-fixas");
});

describe("ajustes da revisão", () => {
  it("mês corrente segue São Paulo, não o fuso do aparelho", () => {
    // 01/12 às 01:30 UTC ainda é 30/11 em São Paulo
    expect(currentMonth(new Date("2026-12-01T01:30:00Z"))).toBe("2026-11");
    expect(currentMonth(new Date("2026-12-01T03:30:00Z"))).toBe("2026-12");
  });

  it("conta que começa depois aparece marcada e conta no compromisso mensal", () => {
    const future = { start_month: "2099-01-01", end_month: null, amount_cents: 1000 } as RecurringBill;
    expect(startsLater(future)).toBe(true);
    expect(activeTotalCents([future])).toBe(1000);
  });
});

it("Ruth troca a conta alheia no seletor e ainda consegue voltar para 'Manter a conta atual'", async () => {
  const bills = FIXED_BILLS.map((b) => (b.id === 1 ? { ...b, account_id: 2 } : { ...b })); // Condomínio (AMBOS) na conta do Matheus
  await openAs(RUTH, { bills });
  await waitForEdit("Condomínio");
  click("Editar", "Condomínio");
  const form = screen.getByRole("form", { name: "Editar conta fixa Condomínio" });
  const select = field(form, "Conta bancária (de onde sai o pagamento)") as unknown as HTMLSelectElement;
  expect(select.value).toBe("2");
  type(select, "1");
  expect(within(select).getByRole("option", { name: "Manter a conta atual" })).toBeTruthy();
  type(select, "2");
  expect(select.value).toBe("2");
});
