import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HideValuesProvider } from "../../ui";
import ReportsPage from "./ReportsPage";

// jsdom não mede layout: o ResponsiveContainer real não renderiza filhos sem tamanho.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});

type Report = {
  month: string;
  income_cents: number;
  expense_cents: number;
  balance_cents: number;
  bills: { total_count: number; paid_count: number; paid_cents: number; open_count: number; open_cents: number };
  previous: { income_cents: number; expense_cents: number };
  expense_delta_cents: number;
  by_category: { category_id: number | null; name: string; total_cents: number; share_bp: number }[];
  daily_cumulative_expense: {
    current: { day: number; cents: number }[];
    previous: { day: number; cents: number }[];
  };
};

const FULL: Report = {
  month: "2026-11-01",
  income_cents: 840000,
  expense_cents: 100000,
  balance_cents: 740000,
  bills: { total_count: 0, paid_count: 0, paid_cents: 0, open_count: 0, open_cents: 0 },
  previous: { income_cents: 800000, expense_cents: 90000 },
  expense_delta_cents: 10000,
  by_category: [
    { category_id: 1, name: "Mercado", total_cents: 85500, share_bp: 8550 },
    { category_id: null, name: "Sem categoria", total_cents: 14500, share_bp: 1450 },
  ],
  daily_cumulative_expense: {
    current: [
      { day: 1, cents: 10000 },
      { day: 2, cents: 100000 },
    ],
    previous: [
      { day: 1, cents: 5000 },
      { day: 2, cents: 5000 },
      { day: 3, cents: 90000 },
    ],
  },
};

const EMPTY: Report = {
  month: "2026-11-01",
  income_cents: 0,
  expense_cents: 0,
  balance_cents: 0,
  bills: { total_count: 0, paid_count: 0, paid_cents: 0, open_count: 0, open_cents: 0 },
  previous: { income_cents: 0, expense_cents: 0 },
  expense_delta_cents: 0,
  by_category: [],
  daily_cumulative_expense: { current: [], previous: [] },
};

let urls: URL[] = [];

function stubReports(pick: (url: URL) => Report | number) {
  urls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request) => {
      const url = new URL(req.url);
      urls.push(url);
      const out = pick(url);
      if (typeof out === "number") return new Response("{}", { status: out });
      return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
    }),
  );
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HideValuesProvider>
        <MemoryRouter>
          <ReportsPage />
        </MemoryRouter>
      </HideValuesProvider>
    </QueryClientProvider>,
  );
}

const lastUrl = () => urls[urls.length - 1];
// O MonthSwitcher do kit não expõe um papel próprio; o rótulo é um <span class="ui-month__label">.
const switcherLabel = () => document.querySelector(".ui-month__label")?.textContent;

beforeEach(() => {
  // Só a data: timers falsos de verdade travariam o react-query.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T15:00:00Z"));
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ReportsPage", () => {
  it("mostra o título e um skeleton enquanto carrega", async () => {
    stubReports(() => FULL);
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Relatórios" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Carregando relatório" })).toBeTruthy();
    await screen.findByRole("group", { name: "Receitas" });
    expect(screen.queryByRole("status", { name: "Carregando relatório" })).toBeNull();
  });

  it("pede o mês corrente (fuso de São Paulo) sem dono e mostra Receitas, Saídas e Balanço", async () => {
    stubReports(() => FULL);
    renderPage();
    const receitas = await screen.findByRole("group", { name: "Receitas" });
    expect(within(receitas).getByText("R$ 8.400,00")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Saídas" })).getByText("R$ 1.000,00")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Balanço" })).getByText("R$ 7.400,00")).toBeTruthy();
    expect(lastUrl().searchParams.get("month")).toBe("2026-11");
    expect(lastUrl().searchParams.get("owner")).toBeNull();
  });

  it("às 22h de 30/11 em São Paulo ainda é novembro (e às 03h UTC de 01/12, também)", async () => {
    vi.setSystemTime(new Date("2026-12-01T02:30:00Z"));
    stubReports(() => FULL);
    renderPage();
    await screen.findByRole("group", { name: "Receitas" });
    expect(lastUrl().searchParams.get("month")).toBe("2026-11");
  });

  it("chips de período: Esse mês, Mês passado e Escolher mês (MonthSwitcher)", async () => {
    stubReports(() => FULL);
    renderPage();
    await screen.findByRole("group", { name: "Receitas" });
    const periodo = screen.getByRole("group", { name: "Período" });
    expect(within(periodo).getByRole("button", { name: "Esse mês" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "Mês anterior" })).toBeNull();

    fireEvent.click(within(periodo).getByRole("button", { name: "Mês passado" }));
    await waitFor(() => expect(lastUrl().searchParams.get("month")).toBe("2026-10"));
    expect(within(periodo).getByRole("button", { name: "Mês passado" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(within(periodo).getByRole("button", { name: "Escolher mês" }));
    expect(switcherLabel()).toBe("outubro de 2026");
    fireEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    await waitFor(() => expect(lastUrl().searchParams.get("month")).toBe("2026-09"));
    expect(switcherLabel()).toBe("setembro de 2026");
  });

  it("não deixa escolher mês no futuro", async () => {
    stubReports(() => FULL);
    renderPage();
    await screen.findByRole("group", { name: "Receitas" });
    fireEvent.click(screen.getByRole("button", { name: "Escolher mês" }));
    const next = screen.getByRole("button", { name: "Próximo mês" }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it("chips de dono mudam o owner da consulta", async () => {
    stubReports(() => FULL);
    renderPage();
    await screen.findByRole("group", { name: "Receitas" });
    const dono = screen.getByRole("group", { name: "Dono" });
    expect(within(dono).getByRole("button", { name: "Todos" }).getAttribute("aria-pressed")).toBe("true");
    for (const [nome, owner] of [
      ["Matheus", "MATHEUS"],
      ["Ruth", "RUTH"],
      ["Ambos", "AMBOS"],
    ] as const) {
      fireEvent.click(within(dono).getByRole("button", { name: nome }));
      await waitFor(() => expect(lastUrl().searchParams.get("owner")).toBe(owner));
    }
    fireEvent.click(within(dono).getByRole("button", { name: "Todos" }));
    await waitFor(() => expect(lastUrl().searchParams.get("owner")).toBeNull());
  });

  it("lista as categorias com percentual a partir de share_bp e mostra a rosca", async () => {
    stubReports(() => FULL);
    renderPage();
    const card = await screen.findByRole("region", { name: "Gastos por categoria" });
    expect(await within(card).findByRole("figure", { name: "Gastos por categoria" })).toBeTruthy();
    const lista = within(card).getByRole("list", { name: "Categorias" });
    const itens = within(lista).getAllByRole("listitem");
    expect(itens).toHaveLength(2);
    expect(within(itens[0]).getByText("Mercado")).toBeTruthy();
    expect(within(itens[0]).getByText("85,5%")).toBeTruthy();
    expect(within(itens[0]).getByText("R$ 855,00")).toBeTruthy();
    expect(within(itens[1]).getByText("Sem categoria")).toBeTruthy();
    expect(within(itens[1]).getByText("14,5%")).toBeTruthy();
  });

  it("mostra a linha do ritmo de gasto", async () => {
    stubReports(() => FULL);
    renderPage();
    const card = await screen.findByRole("region", { name: "Ritmo de gasto" });
    const figure = await within(card).findByRole("figure", { name: "Ritmo de gasto" });
    // Cabeçalhos da tabela acessível do gráfico: uma coluna por série (mês pedido e mês anterior).
    expect(within(figure).getByRole("columnheader", { name: "novembro de 2026" })).toBeTruthy();
    expect(within(figure).getByRole("columnheader", { name: "outubro de 2026" })).toBeTruthy();
    expect(within(figure).getAllByRole("row")).toHaveLength(4); // cabeçalho + dias 1, 2 e 3
  });

  it("o olho oculta os valores dos totais e da lista", async () => {
    localStorage.setItem("finance.hideValues", "1");
    stubReports(() => FULL);
    renderPage();
    const receitas = await screen.findByRole("group", { name: "Receitas" });
    expect(within(receitas).getByRole("img", { name: "Valor oculto" })).toBeTruthy();
    expect(screen.queryByText("R$ 855,00")).toBeNull();
  });

  it("mês vazio mostra zeros e um estado vazio com convite, sem gráfico", async () => {
    stubReports(() => EMPTY);
    renderPage();
    const receitas = await screen.findByRole("group", { name: "Receitas" });
    expect(within(receitas).getByText("R$ 0,00")).toBeTruthy();
    expect(screen.getByText("Sem lançamentos neste período")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Lançar com IA" });
    expect(link.getAttribute("href")).toBe("/lancar");
    expect(screen.queryByRole("figure")).toBeNull();
    expect(document.body.textContent).not.toContain("NaN");
  });

  it("balanço negativo aparece com sinal", async () => {
    stubReports(() => ({ ...FULL, income_cents: 0, expense_cents: 123456789, balance_cents: -123456789 }));
    renderPage();
    const balanco = await screen.findByRole("group", { name: "Balanço" });
    expect(within(balanco).getByText("-R$ 1.234.567,89")).toBeTruthy();
  });

  it("balanço negativo fica em tom de despesa; com o olho fechado o tom não denuncia o sinal", async () => {
    stubReports(() => ({ ...FULL, income_cents: 0, expense_cents: 123456789, balance_cents: -123456789 }));
    renderPage();
    const balanco = await screen.findByRole("group", { name: "Balanço" });
    expect(balanco.className).toContain("ui-stat--expense");

    cleanup();
    localStorage.setItem("finance.hideValues", "1");
    renderPage();
    const oculto = await screen.findByRole("group", { name: "Balanço" });
    expect(within(oculto).getByRole("img", { name: "Valor oculto" })).toBeTruthy();
    expect(oculto.className).not.toContain("ui-stat--expense");
  });

  it("erro da API mostra mensagem e permite tentar de novo", async () => {
    let falhar = true;
    stubReports(() => (falhar ? 500 : FULL));
    renderPage();
    expect(await screen.findByRole("alert")).toBeTruthy();
    falhar = false;
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("group", { name: "Receitas" })).toBeTruthy();
  });
});
