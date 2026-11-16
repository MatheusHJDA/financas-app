import { todaySP } from "../transactions/filters";

/** "2026-11-12" -> "12/11/2026". Qualquer outra coisa volta como veio. */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Hoje em São Paulo (o mesmo fuso da API), qualquer que seja o fuso do aparelho, como "aaaa-mm-dd". */
export function todayIso(now: Date = new Date()): string {
  return todaySP(now);
}

/** Ontem em São Paulo como "aaaa-mm-dd": o dia anterior a `todayIso`, por aritmética de calendário. */
export function yesterdayIso(now: Date = new Date()): string {
  const [y, m, d] = todaySP(now).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

export function isValidIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
