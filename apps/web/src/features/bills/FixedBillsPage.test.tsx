import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

  it("editar mostra o mês de início e mudar envia start_month", async () => {
    const { calls } = await openAs(MATHEUS);
    const form = await editForm("Luz");
    expect(field(form, "Mês de início").value).toBe("2026-01");
    type(field(form, "Mês de início"), "2025-11");
    fireEvent.click(within(form).getByRole("button", { name: "Salvar conta fixa" }));
    await waitFor(() => expect(writes(calls)).toEqual(["PATCH /recurring-bills/2"]));
    expect(await bodyOf(calls, "PATCH /recurring-bills/2")).toEqual({ start_month: "2025-11-01" });
  });

  it("editar avisa que mudar o início não cria contas passadas e remove as abertas antes", async () => {
    await openAs(MATHEUS);
    const form = await editForm("Luz");
    expect(within(form).getByText(/Mudar o mês de início não cria contas de meses passados; contas em aberto antes do novo início são removidas\./)).toBeTruthy();
  });

  it("início depois do mês de encerramento mostra erro e não chama a API", async () => {
    const { calls } = await openAs(RUTH);
    const form = await editForm("Internet");
    type(field(form, "Mês de início"), "2100-01");
    fireEvent.click(within(form).getByRole("button", { name: "Salvar conta fixa" }));
    expect(await within(form).findByText("O mês de início não pode ser depois do mês de encerramento.")).toBeTruthy();
    expect(writes(calls)).toEqual([]);
  });

  it("forma de pagamento é uma lista de escolha", async () => {
    const { calls } = await openAs(MATHEUS);
    const form = await editForm("Luz");
    const select = field(form, "Forma de pagamento (opcional)");
    expect(select.tagName).toBe("SELECT");
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Sem forma de pagamento", "Boleto", "Pix", "Cartão", "Débito automático", "Dinheiro"]);
    expect(select.value).toBe("Pix");
    type(select, "Boleto");
    fireEvent.click(within(form).getByRole("button", { name: "Salvar conta fixa" }));
    await waitFor(() => expect(writes(calls)).toEqual(["PATCH /recurring-bills/2"]));
    expect(await bodyOf(calls, "PATCH /recurring-bills/2")).toEqual({ payment_method: "Boleto" });
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
    // dentro do Sheet (que já é o diálogo modal): grupo nomeado, não um segundo diálogo
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const bar = screen.getByRole("group", { name: /^Excluir Luz\?/ });
    expect(document.activeElement).toBe(bar); // o foco acompanha a troca de painel
    expect(writes(calls)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("group", { name: /^Excluir Luz\?/ })).toBeNull();
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
    const confirm = await screen.findByRole("group", { name: /^Excluir Luz\?/ });
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

describe("parcelas de empréstimo", () => {
  const LOAN_BILL = {
    id: 9,
    owner: "MATHEUS" as const,
    name: "Empréstimo Nubank",
    amount_cents: 100_000,
    due_day: 18,
    start_month: "2026-12-01",
    end_month: null,
    account_id: 2,
    category_id: null,
    payment_method: null,
    debt_id: 7,
  };
  const instance = (id: number, status: "open" | "prepaid") => ({
    id,
    recurring_bill_id: 9,
    name: "Empréstimo Nubank",
    owner: "MATHEUS" as const,
    month: "2026-11-01",
    due_date: "2026-11-18",
    amount_cents: 100_000,
    status,
    debt_id: 7,
  });
  const installment = (id: number, instanceId: number, status: "open" | "prepaid") => ({
    id,
    number: 1,
    due_date: "2026-11-18",
    face_cents: 100_000,
    today_cents: status === "open" ? 100_000 : null,
    savings_cents: status === "open" ? 0 : null,
    status,
    paid_cents: null,
    paid_on: null,
    bill_instance_id: instanceId,
  });
  const loanServer = (status: "open" | "prepaid" = "open") =>
    makeBillsServer(MATHEUS, {
      bills: [...FIXED_BILLS, LOAN_BILL],
      extra: {
        "GET /overview": () =>
          json({
            balances_by_owner: [],
            couple_total_cents: 0,
            open_card_invoices: [],
            debts_balance_cents: 0,
            upcoming_bills: [instance(700, status)],
            overdue_bills: [],
          }),
        "GET /debts/:id/installments": () =>
          json({ remaining_cents: 100_000, paid_cents: 0, payoff_today_cents: 100_000, items: [installment(800, 700, status)] }),
        "POST /debts/:id/installments/pay": () => json({ remaining_cents: 0, paid_cents: 0, payoff_today_cents: 0, items: [] }),
      },
    });
  const renderPage = () =>
    renderApp(
      <MemoryRouter>
        <FixedBillsPage />
      </MemoryRouter>,
    );

  it("pagar parcela do empréstimo abre o formulário com valor, conta e data", async () => {
    const { calls } = loanServer();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Pagar parcela" }));
    const form = await screen.findByRole("form", { name: "Pagar parcelas" });
    await waitFor(() => expect((within(form).getByLabelText("Conta") as HTMLSelectElement).value).toBe("2"));
    expect((within(form).getByLabelText("Valor cobrado") as HTMLInputElement).value).toBe("1000,00");
    fireEvent.change(within(form).getByLabelText("Data"), { target: { value: "2026-11-14" } });
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar pagamento" }));
    await waitFor(() => expect(writes(calls)).toEqual(["POST /debts/7/installments/pay"]));
    expect(await bodyOf(calls, "POST /debts/7/installments/pay")).toEqual({
      installment_ids: [800],
      amount_cents: 100_000,
      account_id: 2,
      date: "2026-11-14",
    });
  });

  it("conta fixa do empréstimo não tem Editar/Excluir e mostra link 'Ver empréstimo'", async () => {
    loanServer();
    renderPage();
    await waitFor(() => expect(rowButton("Empréstimo Nubank")).toBeTruthy());
    openRow("Empréstimo Nubank");
    const sheet = dialog();
    expect(sheet.queryByRole("button", { name: /^Editar/ })).toBeNull();
    expect(sheet.queryByRole("button", { name: /^Excluir/ })).toBeNull();
    expect(sheet.getByRole("link", { name: "Ver empréstimo" }).getAttribute("href")).toBe("/dividas/7");
  });

  it("instância adiantada mostra selo 'Adiantada' e não tem botão Pagar", async () => {
    loanServer("prepaid");
    renderPage();
    const pay = within(await screen.findByRole("region", { name: "Contas a pagar" }));
    expect(await pay.findByText("Adiantada")).toBeTruthy();
    expect(pay.queryByRole("button", { name: /Pagar parcela|Marcar como paga/ })).toBeNull();
  });
});

describe("filtro", () => {
  // Hoje = 14/11/2026. Condomínio paga; Luz (conta 2) aberta; Internet (conta 3) vencida.
  const inst = (id: number, billId: number, name: string, due: string, status: "open" | "paid") => ({
    id,
    recurring_bill_id: billId,
    name,
    owner: "AMBOS",
    month: "2026-11-01",
    due_date: due,
    amount_cents: 1000,
    status,
  });
  const month = [
    inst(41, 1, "Condomínio", "2026-11-10", "paid"),
    inst(42, 2, "Luz", "2026-11-20", "open"),
    inst(43, 3, "Internet", "2026-11-05", "open"),
  ];
  const extra = () => ({ "GET /bill-instances": () => json({ items: month, total: month.length }) });
  const payRegion = () => within(screen.getByRole("region", { name: "Contas a pagar" }));

  beforeEach(() => localStorage.clear());

  it("Pagas esconde as abertas nas duas colunas", async () => {
    await openAs(MATHEUS, { extra: extra() });
    await waitFor(() => expect(payRegion().getByText("Luz")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Pagas" }));
    await waitFor(() => expect(listRegion().queryByRole("button", { name: (n) => n.startsWith("Luz") })).toBeNull());
    expect(rowButton("Condomínio")).toBeTruthy();
    expect(payRegion().queryByText("Luz")).toBeNull();
    expect(payRegion().queryByText("Internet")).toBeNull();
  });

  it("categoria sem contas mostra aviso e Limpar filtros volta a tudo", async () => {
    await openAs(MATHEUS, { extra: extra() });
    // Internet (a única vencida) não tem categoria: Vencidas + Energia elétrica não deixa nada.
    fireEvent.click(screen.getByRole("button", { name: "Vencidas" }));
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "12" } });
    expect(await screen.findByText("Nenhuma conta com esses filtros.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    await waitFor(() => expect(rowButton("Luz")).toBeTruthy());
    expect(payRegion().getByText("Luz")).toBeTruthy();
    expect(screen.queryByText("Nenhuma conta com esses filtros.")).toBeNull();
  });

  it("categoria salva que não existe mais volta para todas e é gravada", async () => {
    localStorage.setItem("fixed-bills-filter", JSON.stringify({ status: "all", categoryId: 999 }));
    await openAs(MATHEUS, { extra: extra() });
    await waitFor(() => expect(JSON.parse(localStorage.getItem("fixed-bills-filter")!).categoryId).toBeNull());
    expect((screen.getByLabelText("Categoria") as HTMLSelectElement).value).toBe("");
    expect(rowButton("Luz")).toBeTruthy();
  });

  it("com situação ativa e o mês carregando mostra o skeleton, não 'Nenhuma conta'", async () => {
    localStorage.setItem("fixed-bills-filter", JSON.stringify({ status: "paid", categoryId: null }));
    makeBillsServer(MATHEUS, { extra: { "GET /bill-instances": () => new Promise<Response>(() => {}) } });
    renderApp(<FixedBillsPage />);
    expect(await screen.findByRole("status", { name: "Carregando contas do mês" })).toBeTruthy();
    expect(screen.queryByText("Nenhuma conta cadastrada com esses filtros.")).toBeNull();
  });

  it("com situação ativa e erro no mês mostra o erro com tentar de novo", async () => {
    localStorage.setItem("fixed-bills-filter", JSON.stringify({ status: "paid", categoryId: null }));
    makeBillsServer(MATHEUS, { extra: { "GET /bill-instances": () => json({ detail: "x" }, 500) } });
    renderApp(<FixedBillsPage />);
    expect(await screen.findByText("Não foi possível carregar as contas do mês.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
    expect(screen.queryByText("Nenhuma conta cadastrada com esses filtros.")).toBeNull();
  });

  it("com filtro ativo, o total mensal avisa que vale para todas as contas", async () => {
    await openAs(MATHEUS, { extra: extra() });
    expect(within(screen.getByRole("group", { name: "Total mensal" })).queryByText(/sem filtro/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pagas" }));
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Total mensal" })).getByText(/todas as contas, sem filtro/)).toBeTruthy());
  });
});
