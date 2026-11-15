import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "./DashboardPage";
import {
  emptyReport,
  json,
  mockApi,
  OVERVIEW,
  REPORT_NOV,
  renderDashboard,
  searchesOf,
  setWidth,
  type MonthReport,
} from "./testing";

// jsdom não mede layout: o ResponsiveContainer real não renderiza filhos sem tamanho.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 14, 12, 0, 0)); // 14/11/2026
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

const region = (name: string) => screen.findByRole("region", { name });
const sentence = (text: string) =>
  screen.queryByText((_, el) => el?.tagName === "P" && el.textContent === text);

describe("saldo", () => {
  it("mostra o total do casal da /overview e não muda ao trocar o mês", async () => {
    const calls = mockApi();
    renderDashboard(<DashboardPage />);

    const saldos = await region("Saldos");
    expect(within(saldos).getByText("Total do casal")).toBeTruthy();
    expect(within(saldos).getByText("R$ 9.080,00")).toBeTruthy(); // 1.500 + 3.000 + 5.000 − 420

    await screen.findByRole("group", { name: "Receitas" });
    expect(searchesOf(calls, "GET /reports/month").at(-1)?.get("month")).toBe("2026-11");

    fireEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    await waitFor(() => expect(searchesOf(calls, "GET /reports/month").at(-1)?.get("month")).toBe("2026-10"));
    await screen.findByRole("group", { name: "Receitas" });

    expect(within(screen.getByRole("region", { name: "Saldos" })).getByText("R$ 9.080,00")).toBeTruthy();
    expect(calls.filter((c) => c.key === "GET /overview")).toHaveLength(1);
  });

  it("'Expandir' mostra os três donos com suas contas e totais", async () => {
    mockApi();
    renderDashboard(<DashboardPage />);
    const saldos = await region("Saldos");
    expect(screen.queryByRole("group", { name: "Saldos de Ruth" })).toBeNull();

    const toggle = within(saldos).getByRole("button", { name: "Expandir" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const ruth = screen.getByRole("group", { name: "Saldos de Ruth" });
    expect(within(ruth).getByText("Nubank Ruth")).toBeTruthy();
    expect(within(ruth).getByText("Total de Ruth")).toBeTruthy();
    expect(within(ruth).getByText("R$ 1.080,00")).toBeTruthy(); // 1.500 − 420
    expect(screen.getByRole("group", { name: "Saldos de Matheus" })).toBeTruthy();
    const ambos = screen.getByRole("group", { name: "Saldos de Ambos" });
    expect(within(ambos).getAllByText("R$ 5.000,00")).toHaveLength(2); // conta + total do dono
    const faturas = screen.getByRole("group", { name: "Faturas abertas dos cartões" });
    expect(within(faturas).getByText("R$ 420,00")).toBeTruthy();

    fireEvent.click(within(saldos).getByRole("button", { name: "Recolher" }));
    expect(screen.queryByRole("group", { name: "Saldos de Ruth" })).toBeNull();
  });

  it("saldo negativo aparece com sinal", async () => {
    mockApi({ overview: { ...OVERVIEW, couple_total_cents: -123_456_789 } });
    renderDashboard(<DashboardPage />);
    const saldos = await region("Saldos");
    expect(within(saldos).getByText("-R$ 1.234.567,89")).toBeTruthy();
  });

  it("o olho oculta o saldo e os cartões do mês", async () => {
    mockApi();
    renderDashboard(<DashboardPage />);
    await screen.findByRole("group", { name: "Receitas" });
    fireEvent.click(screen.getByRole("button", { name: "Ocultar valores" }));
    const saldos = screen.getByRole("region", { name: "Saldos" });
    expect(within(saldos).queryByText("R$ 9.080,00")).toBeNull();
    expect(within(saldos).getAllByRole("img", { name: "Valor oculto" }).length).toBeGreaterThan(0);
    expect(within(screen.getByRole("group", { name: "Receitas" })).queryByText("R$ 8.400,00")).toBeNull();
  });
});

describe("cabeçalho e cartões do mês", () => {
  it("tem o título Início, a saudação e o mês corrente", async () => {
    mockApi();
    renderDashboard(<DashboardPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Início" })).toBeTruthy();
    await screen.findByText("Olá, Matheus");
    expect(screen.getByText("novembro de 2026")).toBeTruthy();
    // não dá para ir além do mês corrente
    expect((screen.getByRole("button", { name: "Próximo mês" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("mostra os quatro cartões do mês vindos da API", async () => {
    mockApi();
    renderDashboard(<DashboardPage />);
    const receitas = await screen.findByRole("group", { name: "Receitas" });
    expect(within(receitas).getByText("R$ 8.400,00")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Despesas" })).getByText("R$ 5.120,00")).toBeTruthy();
    const pagas = screen.getByRole("group", { name: "Contas pagas" });
    expect(within(pagas).getByText("1 de 3")).toBeTruthy();
    expect(within(pagas).getByText("R$ 100,00")).toBeTruthy();
    const apagar = screen.getByRole("group", { name: "A pagar" });
    expect(within(apagar).getByText("R$ 380,00")).toBeTruthy();
    expect(within(apagar).getByText("2 contas")).toBeTruthy();
  });

  it("mostra skeletons com a forma do conteúdo enquanto carrega", async () => {
    mockApi();
    renderDashboard(<DashboardPage />);
    expect(screen.getByRole("status", { name: "Carregando saldos" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Carregando o mês" })).toBeTruthy();
    await screen.findByRole("group", { name: "Receitas" });
    expect(screen.queryByRole("status", { name: "Carregando o mês" })).toBeNull();
    expect(screen.queryByRole("status", { name: "Carregando saldos" })).toBeNull();
  });

  it("erro no relatório mostra aviso com 'Tentar de novo' e o saldo continua", async () => {
    let fail = true;
    mockApi({ report: () => (fail ? json({ detail: "erro" }, 500) : REPORT_NOV) });
    renderDashboard(<DashboardPage />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Não foi possível carregar o mês");
    expect(within(await region("Saldos")).getByText("R$ 9.080,00")).toBeTruthy();
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    await screen.findByRole("group", { name: "Receitas" });
  });
});

describe("aviso comparativo", () => {
  it("'a mais' quando gastou mais que no mês anterior", async () => {
    mockApi();
    renderDashboard(<DashboardPage />);
    await screen.findByRole("group", { name: "Receitas" });
    expect(sentence("Você gastou R$ 50,00 a mais que no mês anterior")).toBeTruthy();
  });

  it("'a menos' quando gastou menos", async () => {
    const less: MonthReport = { ...REPORT_NOV, expense_delta_cents: -7550 };
    mockApi({ report: () => less });
    renderDashboard(<DashboardPage />);
    await screen.findByRole("group", { name: "Receitas" });
    expect(sentence("Você gastou R$ 75,50 a menos que no mês anterior")).toBeTruthy();
  });

  it("some quando o mês anterior não teve despesa", async () => {
    mockApi({ report: () => ({ ...REPORT_NOV, previous: { income_cents: 0, expense_cents: 0 }, expense_delta_cents: 512_000 }) });
    renderDashboard(<DashboardPage />);
    await screen.findByRole("group", { name: "Receitas" });
    expect(screen.queryByText(/Você gastou/)).toBeNull();
  });

  it("gasto igual ao do mês anterior", async () => {
    mockApi({ report: () => ({ ...REPORT_NOV, expense_delta_cents: 0 }) });
    renderDashboard(<DashboardPage />);
    await screen.findByRole("group", { name: "Receitas" });
    expect(sentence("Você gastou o mesmo que no mês anterior")).toBeTruthy();
  });
});

describe("mês vazio", () => {
  it("mostra zeros e o convite para lançar a primeira despesa, sem NaN", async () => {
    mockApi({ report: emptyReport });
    renderDashboard(<DashboardPage />);
    const receitas = await screen.findByRole("group", { name: "Receitas" });
    expect(within(receitas).getByText("R$ 0,00")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Despesas" })).getByText("R$ 0,00")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Contas pagas" })).getByText("0 de 0")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "A pagar" })).getByText("R$ 0,00")).toBeTruthy();

    const link = screen.getByRole("link", { name: "Lance sua primeira despesa" });
    expect(link.getAttribute("href")).toBe("/lancar");
    expect(screen.queryByText(/Você gastou/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/NaN|undefined/);
  });

  it("com lançamentos no mês não mostra o convite", async () => {
    mockApi();
    renderDashboard(<DashboardPage />);
    await screen.findByRole("group", { name: "Receitas" });
    expect(screen.queryByRole("link", { name: "Lance sua primeira despesa" })).toBeNull();
  });
});

describe("contas a pagar, dívidas e metas", () => {
  it("lista atrasadas e próximas com o vencimento em destaque", async () => {
    mockApi();
    renderDashboard(<DashboardPage />);
    const card = await region("Contas a pagar");
    expect(within(card).getByText("Internet")).toBeTruthy();
    expect(within(card).getByText("Atrasada")).toBeTruthy();
    expect(within(card).getByText("Luz")).toBeTruthy();
    expect(within(card).getByText("Vence amanhã")).toBeTruthy();
    expect(within(card).getByText("Aluguel")).toBeTruthy();
    expect(within(card).getByText("Vence em 6 dias")).toBeTruthy();
    expect(within(card).getByText("R$ 189,50")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "Ver contas fixas" }).getAttribute("href")).toBe("/contas-fixas");
  });

  it("sem contas a pagar mostra o estado vazio", async () => {
    mockApi({ overview: { ...OVERVIEW, upcoming_bills: [], overdue_bills: [] } });
    renderDashboard(<DashboardPage />);
    const card = await region("Contas a pagar");
    expect(within(card).getByText("Nenhuma conta a pagar nos próximos dias.")).toBeTruthy();
  });

  it("resume dívidas e metas ativas com barra de progresso", async () => {
    mockApi();
    renderDashboard(<DashboardPage />);
    const dividas = await region("Dívidas");
    expect(within(dividas).getByText("Empréstimo do carro")).toBeTruthy();
    expect(within(dividas).getAllByText("R$ 8.000,00").length).toBeGreaterThan(0);

    const metas = await region("Metas");
    const bar = await within(metas).findByRole("progressbar", { name: "Progresso de Reserva de emergência" });
    expect(bar.getAttribute("aria-valuenow")).toBe("24");
    expect(within(metas).getByText("24%")).toBeTruthy();
    expect(within(metas).getByRole("progressbar", { name: "Progresso de Mercado do mês" }).getAttribute("aria-valuenow")).toBe("100");
    expect(within(metas).queryByText("Meta arquivada")).toBeNull();
  });

  it("sem dívidas e sem metas mostra convites", async () => {
    mockApi({ goals: [], debts: [] });
    renderDashboard(<DashboardPage />);
    expect(await screen.findByText("Nenhuma dívida cadastrada.")).toBeTruthy();
    expect(await screen.findByText("Nenhuma meta ativa.")).toBeTruthy();
  });
});

describe("gráficos", () => {
  it("no celular não mostra Ritmo de gasto nem Top 5 categorias", async () => {
    setWidth(390);
    mockApi();
    renderDashboard(<DashboardPage />);
    await screen.findByRole("group", { name: "Receitas" });
    expect(screen.queryByRole("region", { name: "Ritmo de gasto" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Top 5 categorias" })).toBeNull();
  });

  it("≥1024px mostra o ritmo (atual × anterior) e as 5 maiores categorias + Outras", async () => {
    setWidth(1280);
    mockApi();
    renderDashboard(<DashboardPage />);

    const ritmo = await region("Ritmo de gasto");
    const line = within(ritmo).getByRole("figure", { name: "Ritmo de gasto acumulado" });
    expect(within(line).getByRole("columnheader", { name: "Este mês" })).toBeTruthy();
    expect(within(line).getByRole("columnheader", { name: "Mês anterior" })).toBeTruthy();
    expect(within(line).getAllByRole("row")).toHaveLength(1 + 3); // cabeçalho + 3 dias

    const top = await region("Top 5 categorias");
    const donut = within(top).getByRole("figure", { name: "Despesas por categoria" });
    const rows = within(donut).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getByRole("rowheader").textContent)).toEqual([
      "Mercado",
      "Aluguel",
      "Transporte",
      "Lazer",
      "Saúde",
      "Outras",
    ]);
    // Outras = Educação 200,00 + Sem categoria 120,00, somados em centavos inteiros
    expect(within(rows[5]).getByText("R$ 320,00")).toBeTruthy();
    expect(within(top).getByText("39,1%")).toBeTruthy(); // share_bp 3906
    expect(within(top).getByText("6,3%")).toBeTruthy(); // Outras: 391 + 234 = 625
  });

  it("com até 5 categorias não cria 'Outras'", async () => {
    setWidth(1280);
    mockApi({ report: () => ({ ...REPORT_NOV, by_category: REPORT_NOV.by_category.slice(0, 5) }) });
    renderDashboard(<DashboardPage />);
    const top = await region("Top 5 categorias");
    expect(within(top).queryByText("Outras")).toBeNull();
  });

  it("mês vazio no computador mostra o convite em vez de gráficos vazios", async () => {
    setWidth(1280);
    mockApi({ report: emptyReport });
    renderDashboard(<DashboardPage />);
    await screen.findByRole("link", { name: "Lance sua primeira despesa" });
    expect(screen.queryByRole("region", { name: "Ritmo de gasto" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Top 5 categorias" })).toBeNull();
  });
});
