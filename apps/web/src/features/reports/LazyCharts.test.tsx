import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LazyDonutChart, LazyLineChart } from "./LazyCharts";

afterEach(cleanup);

it("enquanto o gráfico carrega, o leitor de tela ouve 'Carregando gráfico' (status ocupado)", () => {
  render(<LazyDonutChart label="Despesas por categoria" data={[]} />);
  const status = screen.getByRole("status", { name: "Carregando gráfico" });
  expect(status.getAttribute("aria-busy")).toBe("true");
});

it("o mesmo vale para o gráfico de linha", () => {
  render(<LazyLineChart label="Ritmo de gasto" series={[]} />);
  expect(screen.getByRole("status", { name: "Carregando gráfico" })).toBeTruthy();
});
