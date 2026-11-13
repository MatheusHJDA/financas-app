import { expect, it } from "vitest";
import { formatDate, isValidIsoDate, todayIso } from "./dates";
import { centsToInput, formatCents, parseBRL } from "./money";

it("converte texto em reais para centavos inteiros", () => {
  expect(parseBRL("1.234,56")).toBe(123456);
  expect(parseBRL("1234,56")).toBe(123456);
  expect(parseBRL("12,5")).toBe(1250);
  expect(parseBRL("12")).toBe(1200);
  expect(parseBRL("R$ 45,90")).toBe(4590);
  expect(parseBRL("12.5")).toBe(1250);
  expect(parseBRL("1.234")).toBe(123400);
  expect(parseBRL("0,10")).toBe(10);
  // 19,99 * 100 em float daria 1998.9999…: aqui é exato
  expect(parseBRL("19,99")).toBe(1999);
  expect(parseBRL("0,29")).toBe(29);
});

it("rejeita valores inválidos, zero e fora do limite", () => {
  for (const bad of ["", "abc", "0", "0,00", "-5", "1,234,56", "12,345", "1.2.3,4", "99999999999999,99"]) {
    expect(parseBRL(bad), bad).toBeNull();
  }
});

it("formata centavos para exibição e para o campo", () => {
  expect(formatCents(123456)).toBe("R$ 1.234,56");
  expect(formatCents(5)).toBe("R$ 0,05");
  expect(formatCents(100_000_00)).toBe("R$ 100.000,00");
  expect(centsToInput(123456)).toBe("1234,56");
  expect(parseBRL(centsToInput(98765))).toBe(98765);
});

it("formata datas", () => {
  expect(formatDate("2026-11-12")).toBe("12/11/2026");
  expect(todayIso(new Date(2026, 0, 5))).toBe("2026-01-05");
  expect(isValidIsoDate("2026-02-30")).toBe(false);
  expect(isValidIsoDate("2026-02-28")).toBe(true);
});
