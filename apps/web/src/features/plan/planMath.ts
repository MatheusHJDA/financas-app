// Conversões do Plano sem float: dinheiro em centavos inteiros, taxa como texto decimal.
import { parseBRL } from "../chat/money";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "1.234,56" | "0" | "0,00" | "R$ 12,50" -> centavos; null se inválido. Zero é aceito. */
export function parseMoneyInput(input: string, allowNegative = false): number | null {
  const trimmed = input.trim();
  const negative = allowNegative && trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1).trim() : trimmed;
  const cents = parseBRL(body);
  if (cents !== null) return negative ? -cents : cents;
  if (/^(R\$\s*)?0(,0{1,2})?$/i.test(body)) return 0;
  return null;
}

/** Centavos -> texto de campo "1234,56" (sem R$). */
export function centsToField(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** "3,45" (% ao mês) -> "0.0345" (taxa decimal, exata). null se fora de 0..100%. */
export function parsePercentInput(input: string): string | null {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(input.trim().replace(/%$/, "").trim());
  if (!m) return null;
  const hundredths = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (hundredths > 10_000) return null;
  if (hundredths === 10_000) return "1";
  const digits = String(hundredths).padStart(4, "0").replace(/0+$/, "");
  return digits ? `0.${digits}` : "0";
}

/** "0.0345" -> "3,45" (texto de campo em % ao mês), sem passar por float. */
export function rateToPercentText(rate: string): string {
  const [int = "0", frac = ""] = rate.split(".");
  const padded = frac.padEnd(2, "0");
  const whole = (int + padded.slice(0, 2)).replace(/^0+(?=\d)/, "");
  const rest = padded.slice(2).replace(/0+$/, "");
  return rest ? `${whole},${rest}` : whole;
}

/** "2026-12-01" -> "2026-12" (valor de <input type="month">). */
export function isoToMonthInput(iso: string): string {
  return iso.slice(0, 7);
}

/** "2026-12" -> "2026-12-01"; null se não for AAAA-MM. */
export function monthInputToIso(value: string): string | null {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? `${value}-01` : null;
}

/** "2027-04-01" -> "abr/27" (rótulo curto do mês). */
export function monthLabel(iso: string): string {
  const year = iso.slice(2, 4);
  const month = Number(iso.slice(5, 7));
  return `${MONTHS[month - 1]}/${year}`;
}

/** "2027-04-01" -> "abril de 2027" (para leitura em voz alta e títulos). */
export function monthLongLabel(iso: string): string {
  const full = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
  ];
  return `${full[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}`;
}
