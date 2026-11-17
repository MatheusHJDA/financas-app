import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { components } from "../../api/schema";
import { ApiError, assertOk } from "../accounts/shared";

export type Debt = components["schemas"]["Debt"];
export type Installment = components["schemas"]["Installment"];
export type LoanSummary = components["schemas"]["LoanSummary"];

/** Depois de pagar parcelas: dívida, contas a pagar, saldos, lançamentos, metas e relatórios mudam. */
export const AFTER_LOAN_PAID = ["debts", "bill-instances", "overview", "transactions", "accounts", "goals", "report"];

export const loanKey = (id: number) => ["debts", id, "installments"] as const;

async function loadLoan(id: number): Promise<LoanSummary> {
  const { data, response } = await api.GET("/debts/{id}/installments", { params: { path: { id } } });
  if (!data) throw new Error(`HTTP ${response.status}`);
  return data;
}

export const useLoan = (id: number) =>
  useQuery({ queryKey: loanKey(id), queryFn: () => loadLoan(id), enabled: Number.isFinite(id) });

async function loadDebts(): Promise<Debt[]> {
  const { data, response } = await api.GET("/debts", { params: { query: { limit: 200 } } });
  if (!data) throw new Error(`HTTP ${response.status}`);
  return data.items;
}

export const useDebts = () => useQuery({ queryKey: ["debts", "list"], queryFn: loadDebts });

/** Conta bancária da conta fixa da dívida (conta padrão ao pagar). */
export function useLoanAccountId(debtId: number) {
  return useQuery({
    queryKey: ["recurring-bills", "debt", debtId],
    queryFn: async () => {
      const { data, response } = await api.GET("/recurring-bills", { params: { query: { limit: 200 } } });
      if (!data) throw new Error(`HTTP ${response.status}`);
      return data.items.find((b) => b.debt_id === debtId)?.account_id ?? null;
    },
  });
}

export interface PayBody {
  installment_ids: number[];
  amount_cents: number;
  account_id: number;
  date: string;
}

export async function payInstallments(debtId: number, body: PayBody): Promise<LoanSummary> {
  const { data, response, error } = await api.POST("/debts/{id}/installments/pay", { params: { path: { id: debtId } }, body });
  assertOk(response, error);
  if (!data) throw new ApiError(response.status, null);
  return data;
}
