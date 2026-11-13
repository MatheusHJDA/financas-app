// Formatação de datas (fuso America/Sao_Paulo) e números do painel admin.

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/** "2026-11-13T12:30:00Z" -> "13/11/2026 09:30" (horário de Brasília). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTime.format(date).replace(",", "");
}

export function formatInt(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : integer.format(value);
}

/** Centavos de dólar -> "US$ 0,01" (a OpenAI cobra em dólar; sem conversão para reais). */
export function formatUsdCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  const abs = Math.abs(Math.trunc(cents));
  return `${cents < 0 ? "-" : ""}US$ ${integer.format(Math.trunc(abs / 100))},${String(abs % 100).padStart(2, "0")}`;
}

/** Bytes -> "512 B", "12 KB", "3,4 MB" (uma casa a partir de MB). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${integer.format(Math.round(bytes / 1024))} KB`;
  const tenths = Math.round((bytes * 10) / (1024 * 1024));
  return `${Math.trunc(tenths / 10)},${tenths % 10} MB`;
}

export function isLocked(lockedUntil: string | null | undefined, now: number = Date.now()): boolean {
  return !!lockedUntil && new Date(lockedUntil).getTime() > now;
}
