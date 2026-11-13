import { api } from "../../api/client";
import type { components } from "../../api/schema";

export type PlanAssumptions = components["schemas"]["PlanAssumptions"];
export type PlanCardInstallment = components["schemas"]["PlanCardInstallment"];
export type PlanProjection = components["schemas"]["PlanProjection"];
export type PlanMonth = components["schemas"]["PlanMonth"];
export type Scenario = "amortize_now" | "no_amortization";

// Prefixo próprio ["plan"] para todas as consultas desta tela.
export const PLAN_KEY = ["plan"] as const;
export const assumptionsKey = () => [...PLAN_KEY, "assumptions"] as const;
export const projectionKey = (scenario: Scenario) => [...PLAN_KEY, "projection", scenario] as const;

export class PlanError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

function need<T>(data: T | undefined, response: Response): T {
  if (data === undefined) throw new PlanError(response.status);
  return data;
}

export async function fetchAssumptions(): Promise<PlanAssumptions> {
  const { data, response } = await api.GET("/plan/assumptions");
  return need(data, response);
}

export async function fetchProjection(scenario: Scenario): Promise<PlanProjection> {
  const { data, response } = await api.GET("/plan/projection", {
    params: { query: { scenario } },
  });
  return need(data, response);
}

/** PUT substitui todas as premissas. Lança PlanError (422 = valor recusado pela API). */
export async function saveAssumptions(body: PlanAssumptions): Promise<PlanAssumptions> {
  const { data, response } = await api.PUT("/plan/assumptions", { body });
  return need(data, response);
}
