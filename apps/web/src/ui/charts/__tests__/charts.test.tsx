import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HideValuesProvider } from "../../index";
import { BarChart, CATEGORY_PALETTE, DonutChart, LineChart } from "../index";

// jsdom não mede layout: o ResponsiveContainer real não renderiza filhos sem tamanho.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <div data-testid="rc">{children}</div>,
  };
});

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const donut = [
  { key: "mercado", name: "Mercado", cents: 85500 },
  { key: "lazer", name: "Lazer", cents: 14500 },
];

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("CATEGORY_PALETTE", () => {
  it("tem 8 cores distintas", () => {
    expect(CATEGORY_PALETTE).toHaveLength(8);
    expect(new Set(CATEGORY_PALETTE).size).toBe(8);
  });

  it("tem contraste ≥ 3:1 (AA para gráficos) nas superfícies clara e escura", () => {
    for (const c of CATEGORY_PALETTE) {
      expect(contrast(c, "#ffffff"), `${c} no claro`).toBeGreaterThanOrEqual(3);
      expect(contrast(c, "#161c1b"), `${c} no escuro`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("DonutChart", () => {
  it("expõe figure com rótulo e tabela oculta com as linhas certas", () => {
    render(<DonutChart label="Gastos por categoria" data={donut} centerLabel="Total" />);
    const fig = screen.getByRole("figure", { name: "Gastos por categoria" });
    const table = within(fig).getByRole("table");
    expect(table.classList.contains("visually-hidden")).toBe(true);
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3); // cabeçalho + 2
    expect(within(rows[1]).getByText("Mercado")).toBeTruthy();
    expect(rows[1].textContent).toContain("855,00");
    expect(rows[2].textContent).toContain("Lazer");
    expect(rows[2].textContent).toContain("145,00");
  });

  it("vazio ou tudo zero mostra 'Sem dados neste período'", () => {
    const { rerender } = render(<DonutChart label="X" data={[]} />);
    expect(screen.getByText("Sem dados neste período")).toBeTruthy();
    rerender(<DonutChart label="X" data={[{ key: "a", name: "A", cents: 0 }]} />);
    expect(screen.getByText("Sem dados neste período")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("com o olho ligado a tabela mostra 'Valor oculto' e não os números", () => {
    localStorage.setItem("finance.hideValues", "1");
    render(
      <HideValuesProvider>
        <DonutChart label="Gastos" data={donut} />
      </HideValuesProvider>,
    );
    const table = screen.getByRole("table");
    expect(within(table).getAllByLabelText("Valor oculto")).toHaveLength(2);
    expect(table.textContent).not.toContain("855");
  });
});

describe("LineChart", () => {
  const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i + 1, cents: (i + 1) * 1000 }));

  it("tabela tem uma linha por x e uma coluna por série", () => {
    render(
      <LineChart
        label="Ritmo de gasto"
        xLabel={(x) => `dia ${x}`}
        series={[
          { name: "Este mês", tone: "expense", points: pts(3) },
          { name: "Mês passado", tone: "neutral", dashed: true, points: pts(3) },
        ]}
      />,
    );
    const table = within(screen.getByRole("figure", { name: "Ritmo de gasto" })).getByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Período", "Este mês", "Mês passado"]);
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText("dia 2")).toBeTruthy();
  });

  it("aceita séries de 10 e 30 pontos", () => {
    render(
      <LineChart
        label="Ritmo"
        series={[
          { name: "Curta", tone: "info", points: pts(10) },
          { name: "Longa", tone: "neutral", dashed: true, points: pts(30) },
        ]}
      />,
    );
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(31); // cabeçalho + x de 1 a 30
    // x=15 só existe na série longa: a célula da curta fica vazia
    const row15 = within(table).getByText("15").closest("tr") as HTMLElement;
    const cells = within(row15).getAllByRole("cell");
    expect(cells[0].textContent).toBe("");
    expect(cells[1].textContent).toContain("150,00");
  });

  it("vazio mostra 'Sem dados neste período'", () => {
    render(<LineChart label="Ritmo" series={[{ name: "A", tone: "info", points: [] }]} />);
    expect(screen.getByText("Sem dados neste período")).toBeTruthy();
  });

  it("olho ligado oculta os valores da tabela", () => {
    localStorage.setItem("finance.hideValues", "1");
    render(
      <HideValuesProvider>
        <LineChart label="Ritmo" series={[{ name: "A", tone: "info", points: pts(2) }]} />
      </HideValuesProvider>,
    );
    expect(within(screen.getByRole("table")).getAllByLabelText("Valor oculto")).toHaveLength(2);
  });
});

describe("BarChart", () => {
  const data = [
    { key: "2026-12", label: "dez/26", values: [{ name: "Saldo devedor", cents: 120000, tone: "expense" as const }] },
    { key: "2027-01", label: "jan/27", values: [{ name: "Saldo devedor", cents: 80000, tone: "expense" as const }] },
  ];

  it("tabela com uma linha por barra", () => {
    render(<BarChart label="Saldo devedor até a quitação" data={data} />);
    const table = within(screen.getByRole("figure", { name: "Saldo devedor até a quitação" })).getByRole("table");
    expect(table.classList.contains("visually-hidden")).toBe(true);
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1].textContent).toContain("dez/26");
    expect(rows[1].textContent).toContain("1.200,00");
    expect(rows[2].textContent).toContain("800,00");
  });

  it("vazio mostra 'Sem dados neste período'", () => {
    render(<BarChart label="B" data={[]} />);
    expect(screen.getByText("Sem dados neste período")).toBeTruthy();
  });

  it("olho ligado oculta os valores", () => {
    localStorage.setItem("finance.hideValues", "1");
    render(
      <HideValuesProvider>
        <BarChart label="B" data={data} />
      </HideValuesProvider>,
    );
    expect(within(screen.getByRole("table")).getAllByLabelText("Valor oculto")).toHaveLength(2);
  });
});

describe("revisão R1", () => {
  it("centerLabel da rosca fica acessível (fora do aria-hidden)", () => {
    render(<DonutChart label="Gastos" data={donut} centerLabel={<span>Total do mês</span>} />);
    const center = screen.getByText("Total do mês");
    expect(center.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("tooltip respeita o olho e usa a cor da fatia", async () => {
    const { ChartTooltip } = await import("../ChartTooltip");
    localStorage.setItem("finance.hideValues", "1");
    render(
      <HideValuesProvider>
        <ChartTooltip active label="dia 3" payload={[{ name: "Mercado", value: 4590, payload: { color: "#123456" } }]} />
      </HideValuesProvider>,
    );
    expect(screen.getByText("Mercado")).toBeTruthy();
    expect(screen.getByLabelText("Valor oculto")).toBeTruthy();
    expect(screen.queryByText("R$ 45,90")).toBeNull();
    const dot = document.querySelector(".chart-tooltip__dot") as HTMLElement;
    expect(dot.style.background).toContain("rgb(18, 52, 86)");
  });
});
