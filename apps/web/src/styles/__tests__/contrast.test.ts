import { describe, expect, it } from "vitest";
// @ts-expect-error o projeto não inclui @types/node; o Vitest roda em Node e lê o arquivo cru
import { readFileSync } from "node:fs";

// Vitest zera o conteúdo de .css importado (?raw incluído); lê o arquivo direto.
const tokensCss: string = readFileSync("src/styles/tokens.css", "utf8"); // cwd do Vitest = apps/web

// Guarda de contraste (WCAG 2.1 AA) dos tokens: texto ≥ 4.5:1, bordas de controles ≥ 3:1.

function block(startMarker: string): Record<string, string> {
  const start = tokensCss.indexOf(startMarker);
  if (start < 0) throw new Error(`bloco não encontrado: ${startMarker}`);
  const open = tokensCss.indexOf("{", start);
  const close = tokensCss.indexOf("}", open);
  const vars: Record<string, string> = {};
  for (const m of tokensCss.slice(open + 1, close).matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) {
    vars[m[1]] = m[2];
  }
  return vars;
}

const light = block(":root {");
const darkAuto = block(":root:not([data-theme=\"light\"])");
const darkManual = block(":root[data-theme=\"dark\"]");

function channel(hex: string, i: number): number {
  const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
}
function ratio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// [primeiro plano, fundo, mínimo]
const TEXT = 4.5;
const UI = 3;
const PAIRS: Array<[string, string, number]> = [
  ["--color-text", "--color-bg", TEXT],
  ["--color-text", "--color-surface", TEXT],
  ["--color-muted", "--color-surface", TEXT],
  ["--color-muted", "--color-bg", TEXT],
  ["--color-muted", "--color-surface-2", TEXT],
  ["--color-primary", "--color-surface", TEXT],
  ["--color-primary", "--color-bg", TEXT],
  ["--color-primary-strong", "--color-surface-2", TEXT], // .ui-btn--ghost:hover
  ["--color-on-primary", "--color-primary", TEXT],
  ["--color-on-primary", "--color-primary-strong", TEXT],
  ["--color-income", "--tone-income-bg", TEXT],
  ["--color-income", "--color-surface", TEXT],
  ["--color-income", "--color-bg", TEXT],
  ["--color-expense", "--tone-expense-bg", TEXT],
  ["--color-expense", "--color-surface", TEXT],
  ["--color-expense", "--color-bg", TEXT],
  ["--color-info", "--tone-info-bg", TEXT],
  ["--color-info", "--color-surface", TEXT],
  ["--color-warning", "--tone-warning-bg", TEXT],
  ["--color-warning", "--color-surface", TEXT],
  ["--color-warning", "--color-bg", TEXT],
  ["--color-danger", "--color-surface", TEXT],
  ["--color-danger", "--tone-expense-bg", TEXT],
  ["--color-ok", "--color-surface", TEXT],
  ["--color-border-strong", "--color-surface", UI],
  ["--color-border-strong", "--color-bg", UI],
  ["--color-border-strong", "--color-surface-2", UI],
];

describe("tokens: contraste", () => {
  it("o tema escuro é idêntico no modo automático e no manual", () => {
    expect(darkAuto).toEqual(darkManual);
  });

  for (const [name, theme] of [
    ["claro", light],
    ["escuro", darkManual],
  ] as const) {
    describe(name, () => {
      for (const [fg, bg, min] of PAIRS) {
        it(`${fg} sobre ${bg} ≥ ${min}:1`, () => {
          expect(theme[fg], `${fg} existe`).toBeDefined();
          expect(theme[bg], `${bg} existe`).toBeDefined();
          const r = ratio(theme[fg], theme[bg]);
          expect(r).toBeGreaterThanOrEqual(min);
        });
      }
    });
  }
});
