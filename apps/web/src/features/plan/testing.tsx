// Apoio dos testes da aba Plano (não é importado pelo app).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { HideValuesProvider } from "../../ui";
import PlanPage from "./PlanPage";
import { PLANILHA_DEFAULTS } from "./planDefaults";
import type { PlanAssumptions, PlanProjection } from "./planApi";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Projeção pequena e fixa (não é o motor: só dá forma às respostas). */
export const PROJECTION_NOW: PlanProjection = {
  scenario: "amortize_now",
  months: [
    {
      month: "2026-12-01",
      income_cents: 1030000,
      expense_cents: 882633,
      loan_payment_cents: 136282,
      interest_cents: 48300,
      amortization_cents: 209867,
      debt_balance_cents: 1102151,
      reserve_cents: 200000,
    },
    {
      month: "2027-01-01",
      income_cents: 1030000,
      expense_cents: 900000,
      loan_payment_cents: 136282,
      interest_cents: 38000,
      amortization_cents: 147367,
      debt_balance_cents: 856526,
      reserve_cents: 200000,
    },
  ],
  payoff_month: "2027-04-01",
  total_interest_cents: 142887,
  interest_without_amortization_cents: 1070763,
  interest_saved_cents: 927876,
  waiting_cost_per_month_cents: 27600,
};

export const PROJECTION_NONE: PlanProjection = {
  scenario: "no_amortization",
  months: [
    {
      month: "2026-12-01",
      income_cents: 1030000,
      expense_cents: 882633,
      loan_payment_cents: 136282,
      interest_cents: 75900,
      amortization_cents: 0,
      debt_balance_cents: 2139618,
      reserve_cents: 1209867,
    },
    {
      month: "2027-01-01",
      income_cents: 1030000,
      expense_cents: 900000,
      loan_payment_cents: 136282,
      interest_cents: 73800,
      amortization_cents: 0,
      debt_balance_cents: 2077336,
      reserve_cents: 2103585,
    },
  ],
  payoff_month: null,
  total_interest_cents: 801769,
  interest_without_amortization_cents: 1070763,
  interest_saved_cents: 268994,
  waiting_cost_per_month_cents: 27600,
};

export interface FakePlanApi {
  /** Premissas como estão gravadas agora (o PUT substitui). */
  assumptions: () => PlanAssumptions;
  /** Corpos recebidos pelo PUT, em ordem. */
  puts: () => PlanAssumptions[];
  /** Quantas vezes cada cenário foi pedido. */
  projectionCalls: () => Record<string, number>;
}

interface Options {
  assumptions?: PlanAssumptions;
  /** Responde 500 para a projeção (testa o estado de erro). */
  failProjection?: boolean;
  /** Status do PUT (ex.: 422 para testar a mensagem de recusa). */
  putStatus?: number;
  /** Projeção devolvida para "amortizar agora" (padrão: PROJECTION_NOW). */
  now?: PlanProjection;
}

/** fetch simulado com estado: o PUT muda o que o GET devolve, como na API. */
export function fakePlanApi(options: Options = {}): FakePlanApi {
  let stored: PlanAssumptions = JSON.parse(
    JSON.stringify(options.assumptions ?? PLANILHA_DEFAULTS),
  ) as PlanAssumptions;
  const puts: PlanAssumptions[] = [];
  const projectionCalls: Record<string, number> = {};

  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request) => {
      const url = new URL(req.url);
      const path = url.pathname.replace(/^\/api/, "");

      if (req.method === "GET" && path === "/plan/assumptions") return json(stored);

      if (req.method === "PUT" && path === "/plan/assumptions") {
        const body = (await req.json()) as PlanAssumptions;
        puts.push(body);
        if (options.putStatus && options.putStatus !== 200) {
          return json({ detail: "recusado" }, options.putStatus);
        }
        stored = body;
        return json(body);
      }

      if (req.method === "GET" && path === "/plan/projection") {
        const scenario = url.searchParams.get("scenario") ?? "";
        projectionCalls[scenario] = (projectionCalls[scenario] ?? 0) + 1;
        if (options.failProjection) return json({ detail: "falhou" }, 500);
        return json(scenario === "amortize_now" ? (options.now ?? PROJECTION_NOW) : PROJECTION_NONE);
      }

      return json({ detail: "não mockado" }, 500);
    }),
  );

  return {
    assumptions: () => stored,
    puts: () => puts,
    projectionCalls: () => projectionCalls,
  };
}

export function renderPlan() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HideValuesProvider>
      <QueryClientProvider client={client}>
        <PlanPage />
      </QueryClientProvider>
    </HideValuesProvider>,
  );
}
