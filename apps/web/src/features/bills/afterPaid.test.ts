import { expect, it } from "vitest";
import { AFTER_PAID } from "./api";

it("pagar uma conta (pode ser parcela de empréstimo) também invalida a dívida", () => {
  expect(AFTER_PAID).toContain("debts");
});
