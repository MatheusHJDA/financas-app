import type { components } from "../../api/schema";

// Apoio só de exibição do Dashboard (texto e datas). Nenhum cálculo de dinheiro mora aqui.

export type Owner = components["schemas"]["Owner"];
export type AccountType = components["schemas"]["AccountType"];

export const OWNER_LABEL: Record<Owner, string> = { MATHEUS: "Matheus", RUTH: "Ruth", AMBOS: "Ambos" };

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  checking: "Conta corrente",
  savings: "Poupança",
  cash: "Dinheiro",
  meal_voucher: "Vale-refeição",
  credit_card: "Cartão de crédito",
  loan: "Empréstimo",
};

/** Hoje (fuso do aparelho) como "aaaa-mm-dd". */
export function todayIso(now: Date = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

/** Mês corrente como "aaaa-mm". */
export function currentMonth(now: Date = new Date()): string {
  return todayIso(now).slice(0, 7);
}

/** "2026-11-12" -> "12/11/2026". */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Dias de `from` até `to` (datas "aaaa-mm-dd"); negativo = já passou. */
export function daysBetween(from: string, to: string): number {
  const ms = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

/** Pontos-base (1% = 100) -> "39,1%", com um decimal, só com inteiros. */
export function formatShare(bp: number): string {
  const tenths = Math.round(bp / 10);
  return `${Math.trunc(tenths / 10)},${tenths % 10}%`;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
