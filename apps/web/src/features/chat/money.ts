// Dinheiro sempre em centavos inteiros. Nenhum cálculo usa float: texto <-> centavos é feito
// só com inteiros e strings.

const MAX_CENTS = 99_999_999_999; // R$ 999.999.999,99
const thousands = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

const WITH_COMMA = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d{1,2})$/;
const GROUPED = /^\d{1,3}(?:\.\d{3})+$/;
const PLAIN = /^(\d+)(?:\.(\d{1,2}))?$/;

/** "1.234,56" | "1234,5" | "12" | "R$ 12,50" | "12.5" -> centavos inteiros; null se inválido ou zero. */
export function parseBRL(input: string): number | null {
  const s = input.replace(/R\$/gi, "").replace(/\s/g, "");
  if (!s) return null;
  let reais: string;
  let frac = "";
  if (s.includes(",")) {
    const m = WITH_COMMA.exec(s);
    if (!m) return null;
    reais = m[1].replaceAll(".", "");
    frac = m[2];
  } else if (GROUPED.test(s)) {
    reais = s.replaceAll(".", "");
  } else {
    const m = PLAIN.exec(s);
    if (!m) return null;
    reais = m[1];
    frac = m[2] ?? "";
  }
  const cents = Number(reais) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_CENTS) return null;
  return cents;
}

/** Centavos -> "1234,56" (campo de edição). */
export function centsToInput(cents: number): string {
  const abs = Math.abs(Math.trunc(cents));
  return `${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Centavos -> "R$ 1.234,56" (exibição). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}R$ ${thousands.format(Math.trunc(abs / 100))},${String(abs % 100).padStart(2, "0")}`;
}
