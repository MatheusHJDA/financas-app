import type { Owner } from "../accounts/shared";
import type { TxKind } from "../chat/types";

/** Como o período da lista é escolhido (chips de mês). */
export type PeriodMode = "all" | "this" | "last" | "month" | "range";

/** Filtros da lista de movimentações. Texto vazio = sem filtro. */
export interface TxFilters {
  owner: Owner | "";
  accountId: string;
  categoryId: string;
  kind: TxKind | "";
  /** "this"/"last" são relativos ao mês corrente de São Paulo; "month" usa `month`; "range" usa dateFrom/dateTo. */
  period: PeriodMode;
  month: string; // "aaaa-mm", só vale com period "month"
  dateFrom: string;
  dateTo: string;
  q: string;
}

export const EMPTY_FILTERS: TxFilters = {
  owner: "",
  accountId: "",
  categoryId: "",
  kind: "",
  period: "this",
  month: "",
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

const SP_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Hoje em São Paulo (o mesmo fuso do servidor) como "aaaa-mm-dd", qualquer que seja o fuso do aparelho. */
export function todaySP(now: Date = new Date()): string {
  const parts = Object.fromEntries(SP_DAY.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Mês corrente em São Paulo como "aaaa-mm". */
export function currentMonthSP(now: Date = new Date()): string {
  return todaySP(now).slice(0, 7);
}

/** "2026-12" + delta meses -> "aaaa-mm". */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Primeiro e último dia do mês ("aaaa-mm") como datas ISO. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** Mês escolhido pelo chip, ou null quando o período não é um mês. */
export function selectedMonth(f: TxFilters, now: Date = new Date()): string | null {
  if (f.period === "this") return currentMonthSP(now);
  if (f.period === "last") return addMonths(currentMonthSP(now), -1);
  if (f.period === "month") return f.month || currentMonthSP(now);
  return null;
}

/** Filtros -> parâmetros de GET /transactions (só os preenchidos). */
export function filtersToQuery(f: TxFilters, now: Date = new Date()): TxQuery {
  const q: TxQuery = {};
  if (f.owner) q.owner = f.owner;
  if (f.accountId) q.account_id = Number(f.accountId);
  if (f.categoryId) q.category_id = Number(f.categoryId);
  if (f.kind) q.kind = f.kind;
  const month = selectedMonth(f, now);
  if (month) {
    const { from, to } = monthBounds(month);
    q.date_from = from;
    q.date_to = to;
  } else if (f.period === "range") {
    if (f.dateFrom) q.date_from = f.dateFrom;
    if (f.dateTo) q.date_to = f.dateTo;
  }
  const text = f.q.trim();
  if (text) q.q = text;
  return q;
}

/** Link do CSV com os mesmos filtros (sem paginação: o servidor exporta tudo o que casa). */
export function exportHref(f: TxFilters, now: Date = new Date()): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filtersToQuery(f, now))) params.set(key, String(value));
  const qs = params.toString();
  return `/api/transactions/export.csv${qs ? `?${qs}` : ""}`;
}

const LONG_DAY = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "UTC" });

/** Cabeçalho do grupo: "Hoje", "Ontem", "12 de dezembro" (com o ano quando não é o corrente). */
export function dayLabel(iso: string, today: string): string {
  if (iso === today) return "Hoje";
  const [ty, tm, td] = today.split("-").map(Number);
  const yesterday = new Date(Date.UTC(ty, tm - 1, td - 1)).toISOString().slice(0, 10);
  if (iso === yesterday) return "Ontem";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const text = LONG_DAY.format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
  return m[1] === today.slice(0, 4) ? text : `${text} de ${m[1]}`;
}
