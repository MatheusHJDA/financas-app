import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TransactionsPage from "./TransactionsPage";
import { bodyOf, json, makeServer, MATHEUS, renderApp, RUTH, searchOf, TRANSACTIONS, tx, writes } from "./testing";

// 14/11/2026 12:00 em São Paulo. Só o Date é falso: fetch e timers do React Query seguem reais.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T15:00:00Z"));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const row = (text: string) => screen.getByText(text).closest("li") as HTMLElement;
const editBtn = (name: string) => screen.queryByRole("button", { name: `Editar ${name}` });
const deleteBtn = (name: string) => screen.queryByRole("button", { name: `Excluir ${name}` });
const chip = (group: string, name: string) => within(screen.getByRole("group", { name: group })).getByRole("button", { name });

async function openAs(me: typeof RUTH, overrides = {}, initial = TRANSACTIONS) {
  const server = makeServer(me, overrides, initial);
  renderApp(<TransactionsPage />);
  await screen.findByText("Supermercado BH");
  return server;
}

describe("estrutura e agrupamento por dia", () => {
  it("tem o título da página e a region Movimentações", async () => {
    await openAs(RUTH);
    expect(screen.getByRole("heading", { level: 1, name: "Transações" })).toBeTruthy();
    const region = screen.getByRole("region", { name: "Movimentações" });
    expect(within(region).getByText("Supermercado BH")).toBeTruthy();
  });

  it("agrupa por dia com cabeçalhos Hoje, Ontem e a data por extenso", async () => {
    await openAs(RUTH, {}, [
      tx(21, "Café da manhã", "RUTH", "expense", 1200, 1, "2026-11-14"),
      tx(22, "Pão de ontem", "RUTH", "expense", 800, 1, "2026-11-13"),
      tx(23, "Padaria", "RUTH", "expense", 500, 1, "2026-11-13"),
      tx(24, "Supermercado BH", "RUTH", "expense", 4590, 1, "2026-11-10", 10),
    ]);
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Hoje", "Ontem", "10 de novembro"]);
    const ontem = screen.getByRole("heading", { level: 3, name: "Ontem" }).parentElement as HTMLElement;
    expect(within(ontem).getByText("Pão de ontem")).toBeTruthy();
    expect(within(ontem).getByText("Padaria")).toBeTruthy();
    expect(within(ontem).queryByText("Café da manhã")).toBeNull();
  });

  it("mostra o ano quando a data não é do ano corrente e usa o fuso de São Paulo para 'hoje'", async () => {
    // 15/11 01:30 UTC ainda é 14/11 em São Paulo
    vi.setSystemTime(new Date("2026-11-15T01:30:00Z"));
    await openAs(RUTH, {}, [
      tx(31, "Supermercado BH", "RUTH", "expense", 4590, 1, "2026-11-14"),
      tx(32, "Presente", "RUTH", "expense", 9000, 1, "2025-12-12"),
    ]);
    fireEvent.click(chip("Mês", "Todos os meses"));
    await screen.findByText("Presente");
    expect(screen.getByRole("heading", { level: 3, name: "Hoje" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "12 de dezembro de 2025" })).toBeTruthy();
  });

  it("mostra tipo, conta, categoria e dono de cada lançamento e o valor com sinal", async () => {
    await openAs(RUTH);
    const li = row("Supermercado BH");
    expect(li.textContent).toContain("Despesa");
    expect(li.textContent).toContain("Nubank Ruth");
    expect(li.textContent).toContain("Mercado");
    expect(li.textContent).toContain("Ruth");
    expect(within(li).getByText("−R$ 45,90")).toBeTruthy();
    expect(within(row("Salário Ruth")).getByText("+R$ 3.000,00")).toBeTruthy();
  });

  it("transferência mostra origem → destino e valor sem sinal", async () => {
    const transfer = { ...tx(40, "Reserva mensal", "AMBOS", "transfer", 50_000, 2, "2026-11-10"), to_account_id: 3 };
    await openAs(RUTH, {}, [tx(1, "Supermercado BH", "RUTH", "expense", 4590, 1, "2026-11-10"), transfer]);
    const li = row("Reserva mensal");
    expect(li.textContent).toContain("Itaú Matheus → Reserva casal");
    expect(within(li).getByText("R$ 500,00")).toBeTruthy();
  });
});

describe("permissões dos botões", () => {
  it("Ruth: editar/excluir só nos lançamentos dela e nos AMBOS; nunca no do Matheus", async () => {
    await openAs(RUTH);
    expect(editBtn("Supermercado BH")).toBeTruthy();
    expect(deleteBtn("Supermercado BH")).toBeTruthy();
    expect(editBtn("Salário Ruth")).toBeTruthy();
    expect(editBtn("Aluguel novembro")).toBeTruthy(); // AMBOS
    expect(deleteBtn("Aluguel novembro")).toBeTruthy();
    expect(editBtn("Gasolina posto")).toBeNull(); // MATHEUS
    expect(deleteBtn("Gasolina posto")).toBeNull();
  });

  it("Matheus (admin): editar/excluir em todos os lançamentos", async () => {
    await openAs(MATHEUS);
    for (const name of ["Supermercado BH", "Gasolina posto", "Aluguel novembro", "Salário Ruth"]) {
      expect(editBtn(name)).toBeTruthy();
      expect(deleteBtn(name)).toBeTruthy();
    }
  });
});

describe("filtros em chips", () => {
  it("por padrão pede o mês corrente (fuso de SP) e o CSV leva o mesmo período", async () => {
    const { calls } = await openAs(RUTH);
    const s = searchOf(calls, "GET /transactions");
    expect(s.get("date_from")).toBe("2026-11-01");
    expect(s.get("date_to")).toBe("2026-11-30");
    expect(s.get("owner")).toBeNull();
    expect(screen.getByRole("link", { name: "Exportar CSV" }).getAttribute("href")).toBe(
      "/api/transactions/export.csv?date_from=2026-11-01&date_to=2026-11-30",
    );
  });

  it("chips de mês: Mês passado, Todos os meses e Escolher mês com setas", async () => {
    const { calls } = await openAs(RUTH);
    expect(chip("Mês", "Esse mês").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(chip("Mês", "Mês passado"));
    await waitFor(() => expect(searchOf(calls, "GET /transactions").get("date_from")).toBe("2026-10-01"));
    expect(searchOf(calls, "GET /transactions").get("date_to")).toBe("2026-10-31");
    expect(chip("Mês", "Mês passado").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(chip("Mês", "Todos os meses"));
    await waitFor(() => expect(searchOf(calls, "GET /transactions").get("date_from")).toBeNull());
    expect(searchOf(calls, "GET /transactions").get("date_to")).toBeNull();
    expect(screen.getByRole("link", { name: "Exportar CSV" }).getAttribute("href")).toBe("/api/transactions/export.csv");

    fireEvent.click(chip("Mês", "Escolher mês"));
    await waitFor(() => expect(searchOf(calls, "GET /transactions").get("date_from")).toBe("2026-11-01"));
    expect(screen.getByText("novembro de 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    await waitFor(() => expect(searchOf(calls, "GET /transactions").get("date_from")).toBe("2026-10-01"));
    expect(searchOf(calls, "GET /transactions").get("date_to")).toBe("2026-10-31");
    expect(screen.getByText("outubro de 2026")).toBeTruthy();
  });

  it("o fim do mês respeita fevereiro (28 e, em ano bissexto, 29)", async () => {
    const { calls } = await openAs(RUTH);
    fireEvent.click(chip("Mês", "Escolher mês"));
    for (let i = 0; i < 9; i += 1) fireEvent.click(screen.getByRole("button", { name: "Mês anterior" })); // fev/2026
    await waitFor(() => expect(searchOf(calls, "GET /transactions").get("date_from")).toBe("2026-02-01"));
    expect(searchOf(calls, "GET /transactions").get("date_to")).toBe("2026-02-28");
    for (let i = 0; i < 24; i += 1) fireEvent.click(screen.getByRole("button", { name: "Mês anterior" })); // fev/2024
    await waitFor(() => expect(searchOf(calls, "GET /transactions").get("date_from")).toBe("2024-02-01"));
    expect(searchOf(calls, "GET /transactions").get("date_to")).toBe("2024-02-29");
  });

  it("filtros Dono (Ruth/Matheus/Ambos/Todos) mandam o parâmetro certo e mostram só o devido", async () => {
    const { calls } = await openAs(RUTH);
    expect(searchOf(calls, "GET /transactions").get("owner")).toBeNull();

    fireEvent.click(chip("Dono", "Ruth"));
    await waitFor(() => expect(searchOf(calls, "GET /transactions").get("owner")).toBe("RUTH"));
    await waitFor(() => expect(screen.queryByText("Gasolina posto")).toBeNull());
    expect(screen.getByText("Supermercado BH")).toBeTruthy();
    expect(screen.getByText("Salário Ruth")).toBeTruthy();
    expect(screen.queryByText("Aluguel novembro")).toBeNull();

    fireEvent.click(chip("Dono", "Matheus"));
    await waitFor(() => expect(searchOf(calls, "GET /transactions").get("owner")).toBe("MATHEUS"));
    await screen.findByText("Gasolina posto");
    expect(screen.queryByText("Supermercado BH")).toBeNull();

    fireEvent.click(chip("Dono", "Ambos"));
    await waitFor(() => expect(searchOf(calls, "GET /transactions").get("owner")).toBe("AMBOS"));
    await screen.findByText("Aluguel novembro");
    expect(screen.queryByText("Gasolina posto")).toBeNull();

    fireEvent.click(chip("Dono", "Todos"));
    await waitFor(() => expect(searchOf(calls, "GET /transactions").get("owner")).toBeNull());
    await screen.findByText("Gasolina posto");
  });

  it("chip Tipo, Conta, Categoria, Período e busca viram parâmetros; o CSV leva os mesmos filtros", async () => {
    const { calls } = await openAs(RUTH);
    fireEvent.click(chip("Dono", "Ruth"));
    fireEvent.click(chip("Tipo", "Despesa"));
    fireEvent.click(screen.getByRole("button", { name: /Mais filtros/ }));
    fireEvent.change(screen.getByLabelText("Conta"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "10" } });
    fireEvent.click(chip("Mês", "Período"));
    fireEvent.change(screen.getByLabelText("De (data)"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("Até (data)"), { target: { value: "2026-11-12" } });
    fireEvent.change(screen.getByLabelText("Buscar na descrição"), { target: { value: "Super" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));

    await waitFor(() => expect(searchOf(calls, "GET /transactions").get("q")).toBe("Super"));
    expect(Object.fromEntries(searchOf(calls, "GET /transactions"))).toEqual({
      owner: "RUTH",
      account_id: "1",
      category_id: "10",
      kind: "expense",
      date_from: "2026-11-01",
      date_to: "2026-11-12",
      q: "Super",
      limit: "20",
      offset: "0",
    });
    expect(screen.getByRole("link", { name: "Exportar CSV" }).getAttribute("href")).toBe(
      "/api/transactions/export.csv?owner=RUTH&account_id=1&category_id=10&kind=expense&date_from=2026-11-01&date_to=2026-11-12&q=Super",
    );
    await waitFor(() => expect(screen.queryByText("Gasolina posto")).toBeNull());
    expect(screen.getByText("Supermercado BH")).toBeTruthy();
  });

  it("Limpar filtros volta ao mês corrente sem dono, tipo nem busca", async () => {
    const { calls } = await openAs(RUTH);
    expect(screen.queryByRole("button", { name: "Limpar filtros" })).toBeNull();
    fireEvent.click(chip("Dono", "Matheus"));
    fireEvent.click(chip("Mês", "Mês passado"));
    fireEvent.change(screen.getByLabelText("Buscar na descrição"), { target: { value: "xyz" } });
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    await waitFor(() => expect(searchOf(calls, "GET /transactions").get("owner")).toBeNull());
    const s = searchOf(calls, "GET /transactions");
    expect(s.get("date_from")).toBe("2026-11-01");
    expect(s.get("q")).toBeNull();
    expect((screen.getByLabelText("Buscar na descrição") as HTMLInputElement).value).toBe("");
  });
});

describe("editar em Sheet", () => {
  it("abre o Sheet com o formulário; '1.234,56' vira 123456 centavos e o Sheet fecha", async () => {
    const { calls } = await openAs(RUTH);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(editBtn("Supermercado BH")!);
    const dialog = screen.getByRole("dialog", { name: "Editar lançamento" });
    const amount = within(dialog).getByLabelText("Valor (R$)") as HTMLInputElement;
    expect(amount.value).toBe("45,90");
    expect((within(dialog).getByLabelText("Descrição") as HTMLInputElement).value).toBe("Supermercado BH");
    fireEvent.change(amount, { target: { value: "1.234,56" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar lançamento" }));

    await waitFor(() => expect(writes(calls)).toContain("PATCH /transactions/1"));
    const body = await bodyOf(calls, "PATCH /transactions/1");
    expect(body.amount_cents).toBe(123456);
    expect(body.owner).toBe("RUTH");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await screen.findByText("R$ 1.234,56", { exact: false });
    expect(screen.getByText("Lançamento atualizado.")).toBeTruthy();
  });

  it("valor inválido não chama a API", async () => {
    const { calls } = await openAs(RUTH);
    fireEvent.click(editBtn("Supermercado BH")!);
    fireEvent.change(screen.getByLabelText("Valor (R$)"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar lançamento" }));
    expect(await screen.findByText(/Informe um valor maior que zero/)).toBeTruthy();
    expect(writes(calls)).toEqual([]);
  });

  it("403 do servidor mostra 'Você não pode alterar esse lançamento.' dentro do Sheet", async () => {
    await openAs(RUTH, { "PATCH /transactions/:id": () => json({ detail: "x" }, 403) });
    fireEvent.click(editBtn("Supermercado BH")!);
    fireEvent.click(screen.getByRole("button", { name: "Salvar lançamento" }));
    const alert = await screen.findByText("Você não pode alterar esse lançamento.");
    expect(within(screen.getByRole("dialog")).getByText(alert.textContent!)).toBeTruthy();
  });

  it("Cancelar e Esc fecham sem gravar", async () => {
    const { calls } = await openAs(RUTH);
    fireEvent.click(editBtn("Supermercado BH")!);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(editBtn("Supermercado BH")!);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writes(calls)).toEqual([]);
  });

  it("transferência pede conta de destino; trocar para receita limpa o destino e a categoria incompatível", async () => {
    const transfer = { ...tx(40, "Reserva mensal", "AMBOS", "transfer", 50_000, 2, "2026-11-10"), to_account_id: 3 };
    const { calls } = await openAs(MATHEUS, {}, [tx(1, "Supermercado BH", "RUTH", "expense", 4590, 1, "2026-11-10"), transfer]);
    fireEvent.click(editBtn("Reserva mensal")!);
    const dialog = within(screen.getByRole("dialog"));
    expect((dialog.getByLabelText("Conta de destino") as HTMLSelectElement).value).toBe("3");
    fireEvent.change(dialog.getByLabelText("Tipo"), { target: { value: "income" } });
    expect(dialog.queryByLabelText("Conta de destino")).toBeNull();
    fireEvent.click(dialog.getByRole("button", { name: "Salvar lançamento" }));
    await waitFor(() => expect(writes(calls)).toContain("PATCH /transactions/40"));
    const body = await bodyOf(calls, "PATCH /transactions/40");
    expect(body).toMatchObject({ kind: "income", to_account_id: null, category_id: null, amount_cents: 50_000 });
  });
});

describe("excluir", () => {
  it("só grava depois da confirmação", async () => {
    const { calls } = await openAs(RUTH);
    fireEvent.click(deleteBtn("Supermercado BH")!);
    const dialog = screen.getByRole("dialog", { name: "Excluir lançamento" });
    expect(within(dialog).getByText(/Supermercado BH/)).toBeTruthy();
    expect(within(dialog).getByText(/R\$ 45,90/)).toBeTruthy();
    expect(writes(calls)).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writes(calls)).toEqual([]);

    fireEvent.click(deleteBtn("Supermercado BH")!);
    fireEvent.click(screen.getByRole("button", { name: "Sim, excluir" }));
    await waitFor(() => expect(writes(calls)).toEqual(["DELETE /transactions/1"]));
    await waitFor(() => expect(screen.queryByText("Supermercado BH")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Lançamento excluído.")).toBeTruthy();
  });

  it("403 do servidor mostra a mensagem de permissão e mantém o lançamento", async () => {
    await openAs(RUTH, { "DELETE /transactions/:id": () => json({ detail: "x" }, 403) });
    fireEvent.click(deleteBtn("Supermercado BH")!);
    fireEvent.click(screen.getByRole("button", { name: "Sim, excluir" }));
    expect(await screen.findByText("Você não pode alterar esse lançamento.")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Excluir lançamento" })).toBeTruthy();
    expect(screen.getAllByText("Supermercado BH").length).toBeGreaterThan(0);
  });
});

describe("paginação, estados e carregamento", () => {
  const many = Array.from({ length: 25 }, (_v, i) =>
    tx(200 + i, `Item ${String(i).padStart(2, "0")}`, "RUTH", "expense", 1000 + i, 1, "2026-11-01"),
  );
  const paged = {
    "GET /transactions": (req: Request) => {
      const q = new URL(req.url).searchParams;
      const offset = Number(q.get("offset") ?? 0);
      return json({ items: many.slice(offset, offset + Number(q.get("limit") ?? 50)), total: many.length });
    },
  };

  it("20 por página e botões Anterior/Próxima", async () => {
    const { calls } = makeServer(RUTH, paged);
    renderApp(<TransactionsPage />);
    await screen.findByText("Item 00");
    expect(screen.getByText("Mostrando 1–20 de 25")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await screen.findByText("Item 20");
    expect(screen.getByText("Mostrando 21–25 de 25")).toBeTruthy();
    expect(searchOf(calls, "GET /transactions").get("offset")).toBe("20");
    expect(screen.queryByText("Item 00")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Anterior" }));
    await screen.findByText("Item 00");
  });

  it("trocar um filtro volta para a primeira página", async () => {
    const { calls } = makeServer(RUTH, paged);
    renderApp(<TransactionsPage />);
    await screen.findByText("Item 00");
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await screen.findByText("Item 20");
    fireEvent.click(chip("Dono", "Ruth"));
    await waitFor(() => expect(searchOf(calls, "GET /transactions").get("offset")).toBe("0"));
  });

  it("mostra skeleton com nome acessível enquanto carrega, sem spinner", async () => {
    makeServer(RUTH, { "GET /transactions": () => new Promise<Response>(() => {}) });
    renderApp(<TransactionsPage />);
    const loading = await screen.findByRole("status", { name: "Carregando movimentações" });
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelector(".spinner")).toBeNull();
  });

  it("estado vazio (com e sem filtros) e erro com nova tentativa", async () => {
    makeServer(RUTH, { "GET /transactions": () => json({ items: [], total: 0 }) });
    renderApp(<TransactionsPage />);
    expect(await screen.findByText("Nenhuma movimentação")).toBeTruthy();
    expect(screen.getByText("Os lançamentos feitos pelo chat aparecem aqui.")).toBeTruthy();
    fireEvent.click(chip("Dono", "Matheus"));
    expect(await screen.findByText("Nada casa com esses filtros.")).toBeTruthy();
    cleanup();

    makeServer(RUTH, { "GET /transactions": () => json({ detail: "falha" }, 500) });
    renderApp(<TransactionsPage />);
    expect(await screen.findByText("Não foi possível carregar as movimentações.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
  });
});
