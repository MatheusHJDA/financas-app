import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { todayIso } from "../chat/dates";
import { HideValuesProvider } from "../../ui";
import { bodyOf, json, makeServer, MATHEUS, renderApp, RUTH, writes } from "../../test/appTesting";
import AccountsPage from "./AccountsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openAs(me: typeof RUTH, overrides = {}) {
  const server = isolate(makeServer(me, overrides));
  renderApp(<AccountsPage />);
  await screen.findByRole("group", { name: "Saldos de Ruth" });
  return server;
}

/** makeServer copia só a lista, não as contas: o PATCH de um teste vazaria para os outros. */
function isolate(server: ReturnType<typeof makeServer>) {
  server.state.accounts = server.state.accounts.map((a) => ({ ...a }));
  return server;
}

const editBtn = (name: string) => screen.queryByRole("button", { name: `Editar conta ${name}` });

describe("saldos", () => {
  it("mostra skeleton enquanto carrega", () => {
    makeServer(RUTH);
    renderApp(<AccountsPage />);
    expect(screen.getByRole("status", { name: "Carregando contas" }).getAttribute("aria-busy")).toBe("true");
  });

  it("título, total do casal, contas por dono com o total de cada dono (vindo da API)", async () => {
    await openAs(RUTH);
    expect(screen.getByRole("heading", { level: 1, name: "Contas" })).toBeTruthy();
    expect(screen.getByText("Total do casal")).toBeTruthy();
    expect(await screen.findByText("R$ 9.080,00")).toBeTruthy(); // 1.500 + 3.000 + 5.000 − 420
    const ruth = screen.getByRole("group", { name: "Saldos de Ruth" });
    expect(within(ruth).getByText("Nubank Ruth")).toBeTruthy();
    expect(within(ruth).getByText("Cartão Nubank")).toBeTruthy();
    expect(await within(ruth).findByText("Saldo líquido de Ruth")).toBeTruthy();
    expect(within(ruth).getByText("R$ 1.080,00")).toBeTruthy(); // 1.500 − 420
    expect(within(screen.getByRole("group", { name: "Saldos de Matheus" })).getByText("Itaú Matheus")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Saldos de Ambos" })).getByText("Reserva casal")).toBeTruthy();
  });

  it("saldo negativo é pintado; com o olho fechado a cor (conta e total do casal) não denuncia o sinal", async () => {
    const { state } = isolate(makeServer(RUTH));
    state.accounts = state.accounts.filter((a) => a.id === 4); // só o cartão: −420 e total do casal negativo
    const view = renderApp(<AccountsPage />);
    await screen.findByRole("group", { name: "Saldos de Ruth" });
    expect(document.querySelector(".acc-neg")).not.toBeNull();
    expect((await screen.findByRole("group", { name: "Total do casal" })).className).toContain("ui-stat--expense");
    view.unmount();

    localStorage.setItem("finance.hideValues", "1");
    try {
      renderApp(
        <HideValuesProvider>
          <AccountsPage />
        </HideValuesProvider>,
      );
      await screen.findByRole("group", { name: "Saldos de Ruth" });
      await screen.findByRole("group", { name: "Total do casal" });
      expect(document.querySelector(".acc-neg")).toBeNull();
      expect(screen.getByRole("group", { name: "Total do casal" }).className).not.toContain("ui-stat--expense");
    } finally {
      localStorage.removeItem("finance.hideValues");
    }
  });

  it("subtítulo traz o tipo da conta; conta inativa é marcada", async () => {
    const { state } = isolate(makeServer(RUTH));
    state.accounts[0] = { ...state.accounts[0], active: false };
    renderApp(<AccountsPage />);
    const ruth = await screen.findByRole("group", { name: "Saldos de Ruth" });
    expect(within(ruth).getByText(/Conta corrente.*inativa/)).toBeTruthy();
    expect(within(ruth).getByText(/Cartão de crédito/)).toBeTruthy();
  });

  it("faturas abertas e saldo devedor das dívidas", async () => {
    await openAs(RUTH);
    const invoices = await screen.findByRole("group", { name: "Faturas abertas dos cartões" });
    expect(within(invoices).getByText("Cartão Nubank")).toBeTruthy();
    expect(within(invoices).getByText("R$ 420,00")).toBeTruthy();
    expect(within(invoices).getByText(/vence em 20\/11\/2026/)).toBeTruthy();
    expect(screen.getByText("Saldo devedor das dívidas")).toBeTruthy();
    expect(screen.getByText("R$ 8.000,00")).toBeTruthy();
  });

  it("se os saldos do /overview falharem, a lista de contas continua e há 'Tentar de novo'", async () => {
    await openAs(RUTH, { "GET /overview": () => json({ detail: "x" }, 500) });
    expect(await screen.findByText("Não foi possível carregar os saldos.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
    expect(screen.queryByText("Saldo líquido de Ruth")).toBeNull(); // sem o total da API, não inventa
    expect(editBtn("Nubank Ruth")).toBeTruthy();
  });

  it("sem contas mostra o estado vazio e o botão de criar", async () => {
    const { state } = makeServer(RUTH);
    state.accounts = [];
    renderApp(<AccountsPage />);
    await screen.findByText("Nenhuma conta ainda");
    expect(screen.getByRole("button", { name: "Nova conta" })).toBeTruthy();
  });

  it("falha ao carregar as contas mostra erro com 'Tentar de novo'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "x" }), { status: 500 })));
    renderApp(<AccountsPage />);
    await screen.findByText("Não foi possível carregar as contas.");
    expect(screen.getAllByRole("button", { name: "Tentar de novo" }).length).toBeGreaterThan(0);
  });
});

describe("permissões", () => {
  it("Ruth só vê para editar as contas dela e as de AMBOS", async () => {
    await openAs(RUTH);
    await screen.findByRole("button", { name: "Editar conta Nubank Ruth" });
    expect(editBtn("Reserva casal")).toBeTruthy();
    expect(editBtn("Itaú Matheus")).toBeNull();
    // mas o saldo do Matheus continua visível (é do casal)
    expect(screen.getByText("Itaú Matheus")).toBeTruthy();
  });

  it("Matheus (admin) edita todas", async () => {
    await openAs(MATHEUS);
    for (const name of ["Nubank Ruth", "Itaú Matheus", "Reserva casal"]) {
      await screen.findByRole("button", { name: `Editar conta ${name}` });
    }
  });
});

describe("criar e editar em painel", () => {
  it("Ruth cria uma conta (R$ vira centavos) em um Sheet", async () => {
    const { calls } = await openAs(RUTH);
    fireEvent.click(screen.getByRole("button", { name: "Nova conta" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
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
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("empréstimo: explica saldo negativo e conta em um lugar só; saldo positivo é recusado", async () => {
    const { calls } = await openAs(RUTH);
    fireEvent.click(screen.getByRole("button", { name: "Nova conta" }));
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

  it("403 do servidor ao criar mostra a mensagem de permissão", async () => {
    await openAs(RUTH, { "POST /accounts": () => json({ detail: "x" }, 403) });
    fireEvent.click(screen.getByRole("button", { name: "Nova conta" }));
    fireEvent.change(screen.getByLabelText("Nome da conta"), { target: { value: "Carteira" } });
    fireEvent.change(screen.getByLabelText("Saldo inicial (R$)"), { target: { value: "10,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    expect((await screen.findByText("Você não pode criar conta para esse dono.")).getAttribute("role")).toBe("alert");
  });

  it("editar abre o formulário no painel e grava com PATCH", async () => {
    const { calls } = await openAs(RUTH);
    fireEvent.click(await screen.findByRole("button", { name: "Editar conta Nubank Ruth" }));
    const form = screen.getByRole("form", { name: "Editar conta" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((within(form).getByLabelText("Nome da conta") as HTMLInputElement).value).toBe("Nubank Ruth");
    fireEvent.change(within(form).getByLabelText("Nome da conta"), { target: { value: "Nubank da Ruth" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar conta" }));
    await waitFor(() => expect(writes(calls)).toEqual(["PATCH /accounts/1"]));
    expect(await bodyOf(calls, "PATCH /accounts/1")).toMatchObject({ name: "Nubank da Ruth" });
    await screen.findByText("Conta atualizada.");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await screen.findAllByText("Nubank da Ruth")).length).toBeGreaterThan(0);
  });

  it("abrir e cancelar não grava nada", async () => {
    const { calls } = await openAs(RUTH);
    fireEvent.click(await screen.findByRole("button", { name: "Editar conta Nubank Ruth" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Nova conta" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writes(calls)).toEqual([]);
  });
});
