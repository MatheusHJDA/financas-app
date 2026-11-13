import { centsToInput, parseBRL } from "../chat/money";

const ZERO = /^0+(?:[.,]0{1,2})?$/;

/**
 * Dinheiro digitado em R$ -> centavos inteiros, aceitando zero e sinal de menos
 * (saldo de empréstimo é negativo). "1.234,56" -> 123456; "-5.000,00" -> -500000; "0" -> 0.
 * Inválido -> null. Só inteiros e texto, sem float.
 */
export function parseSignedBRL(input: string): number | null {
  let s = input.replace(/R\$/gi, "").replace(/\s/g, "").replace(/^[−–]/, "-");
  let negative = false;
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (ZERO.test(s)) return 0;
  const cents = parseBRL(s);
  if (cents === null) return null;
  return negative ? -cents : cents;
}

/** Centavos -> texto de campo ("-5000,00"). */
export function signedCentsToInput(cents: number): string {
  return `${cents < 0 ? "-" : ""}${centsToInput(cents)}`;
}

/** Centavos -> "R$ 1.200" quando não há centavos, senão "R$ 1.200,50". */
export function formatReaisShort(cents: number): string {
  const abs = Math.abs(Math.trunc(cents));
  const sign = cents < 0 ? "-" : "";
  const reais = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Math.trunc(abs / 100));
  const rest = abs % 100;
  return `${sign}R$ ${reais}${rest === 0 ? "" : `,${String(rest).padStart(2, "0")}`}`;
}
