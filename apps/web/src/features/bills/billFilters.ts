// Filtro de Contas fixas (só na tela): Situação do mês atual + Categoria. Funções puras.
import type { BillInstance } from "../accounts/shared";
import type { RecurringBill } from "./fixedBillForm";

export type BillStatusFilter = "all" | "open" | "paid" | "overdue";

export interface BillFilterState {
  status: BillStatusFilter;
  /** null = todas as categorias. */
  categoryId: number | null;
}

export const NO_FILTER: BillFilterState = { status: "all", categoryId: null };

export const isFiltering = (f: BillFilterState): boolean => f.status !== "all" || f.categoryId !== null;

function matchesStatus(instance: BillInstance, status: BillStatusFilter, today: string): boolean {
  switch (status) {
    case "all":
      return true;
    case "paid":
      return instance.status === "paid" || instance.status === "prepaid";
    case "open":
      return instance.status === "open" && instance.due_date >= today;
    case "overdue":
      return instance.status === "open" && instance.due_date < today;
  }
}

/**
 * Aplica Situação e Categoria. `instances` são as instâncias a avaliar (as do mês, ou as da coluna "A pagar").
 * Devolve as instâncias que passam e as contas cadastradas que passam; com Situação diferente de "Todas",
 * conta sem instância que passe fica de fora.
 */
export function filterBills(
  bills: RecurringBill[],
  instances: BillInstance[],
  filter: BillFilterState,
  today: string,
): { bills: RecurringBill[]; instances: BillInstance[] } {
  const byId = new Map(bills.map((b) => [b.id, b]));
  const categoryOk = (billId: number) => filter.categoryId === null || byId.get(billId)?.category_id === filter.categoryId;
  const kept = instances.filter((i) => matchesStatus(i, filter.status, today) && categoryOk(i.recurring_bill_id));
  const keptBillIds = new Set(kept.map((i) => i.recurring_bill_id));
  return {
    instances: kept,
    bills: bills.filter((b) => (filter.status === "all" ? categoryOk(b.id) : keptBillIds.has(b.id))),
  };
}
