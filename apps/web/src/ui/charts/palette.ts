import type { Tone } from "../Card";

/**
 * 8 cores de categoria. Todas têm luminância entre ~0,13 e ~0,30, o que dá contraste ≥ 3:1 (mínimo AA para
 * elementos gráficos) tanto sobre a superfície clara (#fff) quanto sobre a escura (#161c1b). Um teste confere.
 * A cor de uma categoria é estável: vem do índice dela na lista já ordenada pelo chamador.
 */
export const CATEGORY_PALETTE: string[] = [
  "#2f7de1", // azul
  "#0f9d8a", // verde-água
  "#d97706", // âmbar
  "#8b5cf6", // violeta
  "#e11d74", // rosa
  "#6d8f1f", // oliva
  "#0e8fb3", // ciano
  "#c2410c", // laranja queimado
];

export function categoryColor(index: number): string {
  return CATEGORY_PALETTE[((index % CATEGORY_PALETTE.length) + CATEGORY_PALETTE.length) % CATEGORY_PALETTE.length];
}

const TONE_COLOR: Record<Tone, string> = {
  income: "var(--color-income)",
  expense: "var(--color-expense)",
  info: "var(--color-info)",
  warning: "var(--color-warning)",
  neutral: "var(--color-muted)",
};

export function toneColor(tone: Tone): string {
  return TONE_COLOR[tone];
}
