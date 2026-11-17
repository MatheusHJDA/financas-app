import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { components } from "../../api/schema";
import type { RecurringBill } from "./fixedBillForm";

export type Overview = components["schemas"]["Overview"];

export const RECURRING_BILLS_KEY = ["recurring-bills"] as const;
/** Depois de gravar uma conta fixa, tudo isto fica velho (as contas a pagar nascem das fixas). */
export const AFTER_FIXED_WRITE = ["recurring-bills", "bill-instances", "overview", "report"];
/** Depois de pagar uma conta: lista, saldos, lançamentos, metas e (parcela de empréstimo) dívidas mudam. */
export const AFTER_PAID = ["debts", "bill-instances", "overview", "transactions", "accounts", "goals", "report"];

async function loadRecurringBills(): Promise<RecurringBill[]> {
  const { data, response } = await api.GET("/recurring-bills", { params: { query: { limit: 200 } } });
  if (!data) throw new Error(`HTTP ${response.status}`);
  return data.items;
}

async function loadOverview(): Promise<Overview> {
  const { data, response } = await api.GET("/overview");
  if (!data) throw new Error(`HTTP ${response.status}`);
  return data;
}

export const useRecurringBills = () => useQuery({ queryKey: RECURRING_BILLS_KEY, queryFn: loadRecurringBills });

/** Contas a pagar (vencidas e próximos 15 dias) vêm do /overview. */
export const useOverview = () => useQuery({ queryKey: ["overview"], queryFn: loadOverview });
