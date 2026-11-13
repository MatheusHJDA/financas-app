import type { Owner } from "../accounts/shared";
import type { TxKind } from "../chat/types";

/** Filtros da lista de movimentações. Texto vazio = sem filtro. */
export interface TxFilters {
  owner: Owner | "";
  accountId: string;
  categoryId: string;
  kind: TxKind | "";
  dateFrom: string;
  dateTo: string;
  q: string;
}

export const EMPTY_FILTERS: TxFilters = {
  owner: "",
  accountId: "",
  categoryId: "",
  kind: "",
  dateFrom: "",
  dateTo: "",
  q: "",
};

export const PAGE_SIZE = 20;

export interface TxQuery {
  owner?: Owner;
  account_id?: number;
  category_id?: number;
  kind?: TxKind;
  date_from?: string;
  date_to?: string;
  q?: string;
}

/** Filtros -> parâmetros de GET /transactions (só os preenchidos). */
export function filtersToQuery(f: TxFilters): TxQuery {
  const q: TxQuery = {};
  if (f.owner) q.owner = f.owner;
  if (f.accountId) q.account_id = Number(f.accountId);
  if (f.categoryId) q.category_id = Number(f.categoryId);
  if (f.kind) q.kind = f.kind;
  if (f.dateFrom) q.date_from = f.dateFrom;
  if (f.dateTo) q.date_to = f.dateTo;
  const text = f.q.trim();
  if (text) q.q = text;
  return q;
}

/** Link do CSV com os mesmos filtros (sem paginação: o servidor exporta tudo o que casa). */
export function exportHref(f: TxFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filtersToQuery(f))) params.set(key, String(value));
  const qs = params.toString();
  return `/api/transactions/export.csv${qs ? `?${qs}` : ""}`;
}
