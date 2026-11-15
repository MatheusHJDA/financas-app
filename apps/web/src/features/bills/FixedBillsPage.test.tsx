import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bodyOf, json, MATHEUS, renderApp, RUTH, writes } from "../../test/appTesting";
import { currentMonth } from "./fixedBillForm";
import FixedBillsPage from "./FixedBillsPage";
import { FIXED_BILLS, makeBillsServer } from "./testing";

beforeEach(() => {
  // Só a data é falsa (timers reais): "hoje" = 14/11/2026 em São Paulo.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T15:00:00Z"));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

type Options = Parameters<typeof makeBillsServer>[1];

const listRegion = () => within(screen.getByRole("region", { name: "Cadastradas" }));
const rowButton = (name: string) => listRegion().getByRole("button", { name: (n) => n.startsWith(name) });
const openRow = (name: string) => fireEvent.click(rowButton(name));
const btn = (verb: string, name: string) => screen.queryByRole("button", { name: `${verb} ${name}` });
const click = (verb: string, name: string) => fireEvent.click(screen.getByRole("button", { name: `${verb} ${name}` }));
const field = (form: HTMLElement, label: string) => within(form).getByLabelText(label) as HTMLInputElement;
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const dialog = () => within(screen.getByRole("dialog"));

async function openAs(me: typeof RUTH, opts: Options = {}) {
  const server = makeBillsServer(me, opts);
  renderApp(<FixedBillsPage />);
  await waitFor(() => expect(rowButton("Condomínio")).toBeTruthy());
  return server;
}

/** Abre a conta fixa na lista e escolhe a ação ("Editar", "Encerrar"...). */
async function act(verb: string, name: string) {
  openRow(name);
  click(verb, name);
}

async function editForm(name: string) {
  await act("Editar", name);
  return screen.findByRole("form", { name: `Editar conta fixa ${name}` });
}

describe("lista de contas fixas", () => {
  it("mostra skeleton enquanto carrega", () => {
    makeBillsServer(MATHEUS);
    renderApp(<FixedBillsPage />);
    expect(screen.getByRole("status", { name: "Carregando contas fixas" }).getAttribute("aria-busy")).toBe("true");
  });

  it("título da tela e lista por dia de vencimento, com selos e valores", async () => {
    await openAs(MATHEUS);
    expect(screen.getByRole("heading", { level: 1, name: "Contas fixas" })).toBeTruthy();
    const names = listRegion()
      .getAllByRole("listitem")
      .map((li) => li.querySelector(".ui-li__title")?.textContent);
    expect(names).toEqual(["Luz", "Condomínio", "Seguro antigo", "Internet"]); // dias 5, 10, 15, 20
    const luz = within(rowButton("Luz"));
    expect(luz.getByText("R$ 200,00")).toBeTruthy();
    expect(luz.getByText(/vence dia 5/)).toBeTruthy();
    expect(within(rowButton("Internet")).getByText(/encerra em 12\/2099/)).toBeTruthy();
    expect(within(rowButton("Seguro antigo")).getByText("Encerrada em 01/2020")).toBeTruthy();
  });

  it("soma só as ativas (a encerrada fica de fora)", async () => {
    await openAs(MATHEUS);
    // 180,00 + 200,00 + 89,90 (o "Seguro antigo" já encerrou e não entra)
    const total = screen.getByRole("group", { name: "Total mensal" });
    expect(within(total).getByText("R$ 469,90")).toBeTruthy();
    expect(within(total).getByText(/inclui as que começam nos próximos meses/i)).toBeTruthy();
  });

  it("o detalhe mostra conta, categoria e forma de pagamento", async () => {
    await openAs(MATHEUS);
    openRow("Luz");
    const sheet = dialog();
    expect(await sheet.findByText("Itaú Matheus")).toBeTruthy(); // contas e categorias podem chegar depois da lista
    expect(await sheet.findByText("Energia elétrica")).toBeTruthy();
    expect(sheet.getByText("Pix")).toBeTruthy();
    expect(sheet.getByText("R$ 200,00")).toBeTruthy();
  });

  it("destaca conta fixa sem conta bancária e explica o efeito", async () => {
    await openAs(MATHEUS);
    expect(within(rowButton("Condomínio")).getByText("Sem conta bancária")).toBeTruthy();
    expect(within(rowButton("Luz")).queryByText("Sem conta bancária")).toBeNull();
    openRow("Condomínio");
    expect(dialog().getByText(/Marcar como paga/)).toBeTruthy();
  });

  it("lista vazia mostra o estado vazio e o botão de criar", async () => {
    makeBillsServer(MATHEUS, { bills: [] });
    renderApp(<FixedBillsPage />);
    await screen.findByText("Nenhuma conta fixa");
    expect(screen.getByRole("button", { name: "Nova conta fixa" })).toBeTruthy();
  });

  it("falha ao carregar mostra erro com 'Tentar de novo'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "x" }), { status: 500 })));
    renderApp(<FixedBillsPage />);
    await screen.findByText("Não foi possível carregar as contas fixas.");
    expect(screen.getAllByRole("button", { name: "Tentar de novo" }).length).toBeGreaterThan(0);
  });
});

describe("editar", () => {
  it("só o dia de vencimento envia PATCH {due_day}", async () => {
    const { calls, bills } = await openAs(MATHEUS);
    const form = await editForm("Luz");
    expect(field(form, "Valor mensal (R$)").value).toBe("200,00");
    expect(within(form).getByText(/último dia do mês/)).toBeTruthy(); // aviso dos dias 29–31
    type(field(form, "Dia do vencimento (1 a 31)"), "15");
    fireEvent.click(within(form).getByRole("button", { name: "Salvar conta fixa" }));
    await waitFor(() => expect(writes(calls)).toEqual(["PATCH /recurring-bills/2"]));
    expect(await bodyOf(calls, "PATCH /recurring-bills/2")).toEqual({ due_day: 15 });
    expect(bills.bills.find((b) => b.id === 2)?.due_day).toBe(15);
    await screen.findByText("Luz atualizada.");
    // fecha o painel e recarrega a lista
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(calls.filter((c) => c.key === "GET /recurring-bills").length).toBeGreaterThan(1));
  });

  it("valor '1.234,56' vira 123456 centavos", async () => {
    const { calls } = await openAs(MATHEUS);
    const form = await editForm("Luz");
    type(field(form, "Valor mensal (R$)"), "1.234,56");
    fireEvent.click(within(form).getByRole("button", { name: "Salvar conta fixa" }));
    await waitFor(() => expect(writes(calls)).toEqual(["PATCH /recurring-bills/2"]));
    expect(await bodyOf(calls, "PATCH /recurring-bills/2")).toEqual({ amount_cents: 123_456 });
  });

  it("valor inválido, zero ou negativo não grava e mostra o erro", async () => {
    const { calls } = await openAs(MATHEUS);
    const form = await editForm("Luz");
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
    const form = await editForm("Condomínio");
    type(field(form, "Conta bancária (de onde sai o pagamento)"), "3");
    type(field(form, "Forma de pagamento (opcional)"), "");
    fireEvent.click(within(form).getByRole("button", { name: "Salvar conta fixa" }));
    await waitFor(() => expect(writes(calls)).toEqual(["PATCH /recurring-bills/1"]));
    expect(await bodyOf(calls, "PATCH /recurring-bills/1")).toEqual({ account_id: 3, payment_method: null });
  });

  it("sem mudança nenhuma, Salvar não chama a API", async () => {
    const { calls } = await openAs(MATHEUS);
    const form = await editForm("Luz");
    fireEvent.click(within(form).getByRole("button", { name: "Salvar conta fixa" }));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Editar conta fixa Luz" })).toBeNull());
    expect(writes(calls)).toEqual([]);
  });

  it("Ruth: o seletor de conta não mostra a conta do Matheus nem categoria de receita", async () => {
    await openAs(RUTH);
    const form = await editForm("Condomínio");
    const accounts = within(field(form, "Conta bancária (de onde sai o pagamento)"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(accounts).toEqual(["Sem conta bancária", "Nubank Ruth (Ruth)", "Reserva casal (Ambos)", "Cartão Nubank (Ruth)"]);
    expect(within(form).queryByText(/Itaú Matheus/)).toBeNull();
    const categories = within(field(form, "Categoria")).getAllByRole("option").map((o) => o.textContent);
    expect(categories).toEqual(["Sem categoria", "Mercado", "Energia elétrica", "Combustível"]);
    const owners = within(field(form, "Dono")).getAllByRole("option").map((o) => o.textContent);
    expect(owners).toEqual(["Ruth", "Ambos"]);
  });

  it("Matheus (admin) vê todas as contas no seletor", async () => {
    await openAs(MATHEUS);
    const form = await editForm("Condomínio");
    expect(within(field(form, "Conta bancária (de onde sai o pagamento)")).getAllByRole("option")).toHaveLength(5); // sem conta + 4
  });

  it("Ruth não vê editar, encerrar nem excluir na conta fixa do Matheus", async () => {
    await openAs(RUTH);
    openRow("Luz");
    expect(dialog().getByText("Luz")).toBeTruthy(); // vê o detalhe
    for (const verb of ["Editar", "Encerrar", "Excluir", "Reativar"]) expect(btn(verb, "Luz")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    for (const name of ["Condomínio", "Internet"]) {
      // AMBOS e dela
      openRow(name);
      for (const verb of ["Editar", "Encerrar", "Excluir"]) expect(btn(verb, name)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    }
  });

  it("403 do servidor mostra 'Você não pode alterar essa conta fixa.'", async () => {
    const { calls } = await openAs(RUTH);
    const form = await editForm("Internet");
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

  it("Ruth troca a conta alheia no seletor e ainda consegue voltar para 'Manter a conta atual'", async () => {
    const bills = FIXED_BILLS.map((b) => (b.id === 1 ? { ...b, account_id: 2 } : { ...b })); // Condomínio (AMBOS) na conta do Matheus
    await openAs(RUTH, { bills });
    const form = await editForm("Condomínio");
    const select = field(form, "Conta bancária (de onde sai o pagamento)") as unknown as HTMLSelectElement;
    expect(select.value).toBe("2");
    type(select, "1");
    expect(within(select).getByRole("option", { name: "Manter a conta atual" })).toBeTruthy();
    type(select, "2");
    expect(select.value).toBe("2");
  });
});

describe("excluir, encerrar e reativar", () => {
  it("excluir: pede confirmação, nada é gravado antes, e depois remove", async () => {
    const { calls } = await openAs(MATHEUS);
    await act("Excluir", "Luz");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(writes(calls)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(writes(calls)).toEqual([]);

    click("Excluir", "Luz");
    fireEvent.click(screen.getByRole("button", { name: "Sim, excluir" }));
    await waitFor(() => expect(writes(calls)).toEqual(["DELETE /recurring-bills/2"]));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Cadastradas" })).queryByText("Luz")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("excluir com 409 mostra o detail e oferece Encerrar no lugar", async () => {
    const { calls } = await openAs(MATHEUS, { conflictIds: [2] });
    await act("Excluir", "Luz");
    fireEvent.click(screen.getByRole("button", { name: "Sim, excluir" }));
    const confirm = await screen.findByRole("alertdialog");
    await within(confirm).findByText(/já tem pagamentos registrados/);
    expect(within(confirm).queryByRole("button", { name: "Sim, excluir" })).toBeNull(); // não adianta repetir
    expect(writes(calls)).toEqual(["DELETE /recurring-bills/2"]);

    fireEvent.click(screen.getByRole("button", { name: "Encerrar Luz" }));
    // Agora o painel de encerrar: campo de mês com o mês corrente.
    const month = (await screen.findByLabelText("Último mês cobrado")) as HTMLInputElement;
    expect(month.value).toBe(currentMonth());
    expect(screen.queryByText(/já tem pagamentos registrados/)).toBeNull();
  });

  it("encerrar envia end_month no primeiro dia do mês, só depois da confirmação", async () => {
    const { calls } = await openAs(MATHEUS);
    await act("Encerrar", "Luz");
    type(screen.getByLabelText("Último mês cobrado"), "2027-02");
    expect(screen.getByText("Encerrar Luz em 02/2027?")).toBeTruthy();
    expect(writes(calls)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Sim, encerrar" }));
    await waitFor(() => expect(writes(calls)).toEqual(["PATCH /recurring-bills/2"]));
    expect(await bodyOf(calls, "PATCH /recurring-bills/2")).toEqual({ end_month: "2027-02-01" });
    await waitFor(() => expect(within(rowButton("Luz")).getByText(/encerra em 02\/2027/)).toBeTruthy());
  });

  it("encerrar antes do mês de início é recusado no app", async () => {
    const { calls } = await openAs(MATHEUS);
    await act("Encerrar", "Luz");
    type(screen.getByLabelText("Último mês cobrado"), "2025-12");
    expect((await screen.findByRole("alert")).textContent).toMatch(/não pode ser anterior ao início \(01\/2026\)/);
    expect(screen.queryByRole("button", { name: "Sim, encerrar" })).toBeNull();
    expect(writes(calls)).toEqual([]);
  });

  it("reativar envia end_month null, com confirmação", async () => {
    const { calls } = await openAs(MATHEUS);
    await act("Reativar", "Internet");
    expect(writes(calls)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Sim, reativar" }));
    await waitFor(() => expect(writes(calls)).toEqual(["PATCH /recurring-bills/3"]));
    expect(await bodyOf(calls, "PATCH /recurring-bills/3")).toEqual({ end_month: null });
  });
});

describe("nova conta fixa", () => {
  it("abre em painel; mês de início padrão é o corrente e o valor vira centavos", async () => {
    const { calls } = await openAs(RUTH);
    fireEvent.click(screen.getByRole("button", { name: "Nova conta fixa" }));
    const form = await screen.findByRole("form", { name: "Nova conta fixa" });
    expect(screen.getByRole("dialog")).toBeTruthy();
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
    await waitFor(() => expect(rowButton("Streaming")).toBeTruthy());
    await screen.findByText("Streaming criada.");
  });

  it("abrir e cancelar os formulários não grava nada", async () => {
    const { calls } = await openAs(MATHEUS);
    await act("Editar", "Luz");
    await screen.findByRole("form", { name: "Editar conta fixa Luz" });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" })); // volta ao detalhe
    click("Encerrar", "Luz");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    fireEvent.click(screen.getByRole("button", { name: "Nova conta fixa" }));
    await screen.findByRole("form", { name: "Nova conta fixa" });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writes(calls)).toEqual([]);
  });
});

describe("contas a pagar", () => {
  const payRegion = () => within(screen.getByRole("region", { name: "Contas a pagar" }));
  const payRow = (name: string) => payRegion().getByText(name).closest("li") as HTMLElement;

  async function openPay(me: typeof RUTH) {
    const server = makeBillsServer(me);
    renderApp(<FixedBillsPage />);
    await screen.findByRole("group", { name: "Próximos 15 dias" });
    return server;
  }

  it("mostra selos: Atrasada e Vence amanhã, com a data vinda da API", async () => {
    await openPay(MATHEUS);
    const overdue = screen.getByRole("group", { name: "Contas vencidas" });
    expect(within(overdue).getByText("Internet")).toBeTruthy();
    expect(within(overdue).getByText("Atrasada")).toBeTruthy();
    const upcoming = screen.getByRole("group", { name: "Próximos 15 dias" });
    expect(within(upcoming).getByText("Vence amanhã")).toBeTruthy(); // Luz vence 15/11, hoje é 14/11 em SP
    expect(within(payRow("Luz")).getByText("R$ 189,50")).toBeTruthy();
  });

  it("'Vence em 2 dias' conta o dia de São Paulo", async () => {
    // 13/11 às 01:30 UTC ainda é 12/11 em São Paulo: Luz (15/11) vence em 3 dias; às 04:00 UTC, em 2 dias.
    vi.setSystemTime(new Date("2026-11-13T04:00:00Z"));
    await openPay(MATHEUS);
    expect(within(screen.getByRole("group", { name: "Próximos 15 dias" })).getByText("Vence em 2 dias")).toBeTruthy();
    cleanup();
    vi.setSystemTime(new Date("2026-11-13T01:30:00Z"));
    await openPay(MATHEUS);
    expect(within(screen.getByRole("group", { name: "Próximos 15 dias" })).getByText("Vence em 3 dias")).toBeTruthy();
  });

  it("só o dono (ou admin) vê 'Marcar como paga'", async () => {
    await openPay(RUTH);
    const overdue = screen.getByRole("group", { name: "Contas vencidas" });
    expect(within(overdue).getByRole("button", { name: "Marcar como paga" })).toBeTruthy(); // dela
    const upcoming = screen.getByRole("group", { name: "Próximos 15 dias" });
    expect(within(upcoming).queryByRole("button", { name: "Marcar como paga" })).toBeNull(); // do Matheus
  });

  it("Marcar como paga só grava após a confirmação (POST sem corpo)", async () => {
    const { calls } = await openPay(MATHEUS);
    fireEvent.click(within(payRow("Luz")).getByRole("button", { name: "Marcar como paga" }));
    expect(screen.getByText("Marcar Luz como paga?")).toBeTruthy();
    expect(writes(calls)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByText("Marcar Luz como paga?")).toBeNull();
    expect(writes(calls)).toEqual([]);

    fireEvent.click(within(payRow("Luz")).getByRole("button", { name: "Marcar como paga" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, marcar como paga" }));
    await waitFor(() => expect(writes(calls)).toEqual(["POST /bill-instances/31/pay"]));
    const call = calls.find((c) => c.key === "POST /bill-instances/31/pay")!;
    expect(await call.req.clone().text()).toBe("");
    await waitFor(() => expect(screen.queryByText("Marcar Luz como paga?")).toBeNull());
    await waitFor(() => expect(payRegion().queryByText("Luz")).toBeNull());
    expect(screen.getByText("Luz marcada como paga.")).toBeTruthy();
  });

  it("422 (conta fixa sem conta bancária) mostra o detail e manda lançar pelo chat", async () => {
    const detail = "A conta não tem conta bancária associada; informe transaction_id.";
    makeBillsServer(MATHEUS);
    // sobrepõe só o pagamento, mantendo o resto do servidor simulado
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", async (req: Request) =>
      req.method === "POST" && new URL(req.url).pathname.endsWith("/pay") ? json({ detail }, 422) : original(req),
    );
    renderApp(<FixedBillsPage />);
    await screen.findByRole("group", { name: "Próximos 15 dias" });
    fireEvent.click(within(payRow("Luz")).getByRole("button", { name: "Marcar como paga" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, marcar como paga" }));
    const alert = await screen.findByText(/não tem conta bancária associada/);
    expect(alert.textContent).toContain(detail);
    expect(alert.textContent).toContain("Lance o pagamento pelo chat");
    expect(screen.queryByRole("button", { name: "Sim, marcar como paga" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Fechar" }).length).toBeGreaterThan(0);
  });

  it("sem nada a pagar mostra o estado vazio", async () => {
    const { state } = makeBillsServer(MATHEUS);
    state.upcoming = [];
    state.overdue = [];
    renderApp(<FixedBillsPage />);
    await screen.findByText("Nenhuma conta a pagar");
  });
});
