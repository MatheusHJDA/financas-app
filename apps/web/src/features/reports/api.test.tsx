import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { monthReportKey, useMonthReport } from "./api";

const REPORT = {
  month: "2026-12-01",
  income_cents: 840000,
  expense_cents: 512000,
  balance_cents: 328000,
  bills: { total_count: 14, paid_count: 9, paid_cents: 320000, open_count: 5, open_cents: 183000 },
  previous: { income_cents: 800000, expense_cents: 507000 },
  expense_delta_cents: 5000,
  by_category: [],
  daily_cumulative_expense: { current: [], previous: [] },
};

let urls: string[] = [];

function Probe({ month, owner }: { month: string; owner?: "RUTH" | "MATHEUS" | "AMBOS" }) {
  const q = useMonthReport(month, owner);
  return <p>{q.data ? `receitas ${q.data.income_cents}` : "carregando"}</p>;
}

function renderProbe(month: string, owner?: "RUTH" | "MATHEUS" | "AMBOS") {
  urls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request) => {
      urls.push(req.url);
      return new Response(JSON.stringify(REPORT), { headers: { "Content-Type": "application/json" } });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Probe month={month} owner={owner} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("busca o relatório do mês sem dono", async () => {
  renderProbe("2026-12");
  expect(await screen.findByText("receitas 840000")).toBeTruthy();
  const url = new URL(urls[0]);
  expect(url.pathname).toBe("/api/reports/month");
  expect(url.searchParams.get("month")).toBe("2026-12");
  expect(url.searchParams.has("owner")).toBe(false);
});

it("manda o dono quando escolhido", async () => {
  renderProbe("2026-11", "RUTH");
  await screen.findByText("receitas 840000");
  expect(new URL(urls[0]).searchParams.get("owner")).toBe("RUTH");
});

it("chave de cache separa mês e dono", () => {
  expect(monthReportKey("2026-12")).toEqual(["report", "2026-12", "all"]);
  expect(monthReportKey("2026-12", "AMBOS")).toEqual(["report", "2026-12", "AMBOS"]);
});
