import { expect, it } from "vitest";
import { accountToForm, emptyAccountForm, formToAccountBody } from "./accountForm";
import { formatReaisShort, parseSignedBRL, signedCentsToInput } from "./money";

it("dinheiro em R$ vira centavos inteiros, com sinal e zero", () => {
  expect(parseSignedBRL("1.234,56")).toBe(123456);
  expect(parseSignedBRL("R$ 12,5")).toBe(1250);
  expect(parseSignedBRL("-5.000,00")).toBe(-500000);
  expect(parseSignedBRL("−5.000,00")).toBe(-500000); // sinal de menos tipográfico
  expect(parseSignedBRL("0")).toBe(0);
  expect(parseSignedBRL("0,00")).toBe(0);
  expect(Object.is(parseSignedBRL("-0"), -0)).toBe(false);
  expect(parseSignedBRL("")).toBeNull();
  expect(parseSignedBRL("abc")).toBeNull();
  expect(parseSignedBRL("1,234,56")).toBeNull();
});

it("centavos -> texto de campo e exibição curta", () => {
  expect(signedCentsToInput(-500000)).toBe("-5000,00");
  expect(signedCentsToInput(123456)).toBe("1234,56");
  expect(formatReaisShort(120000)).toBe("R$ 1.200");
  expect(formatReaisShort(120050)).toBe("R$ 1.200,50");
  expect(formatReaisShort(-1000)).toBe("-R$ 10");
});

it("formulário de conta -> corpo com saldo em centavos", () => {
  const form = { ...emptyAccountForm("RUTH"), name: " Nubank ", balance: "1.234,56", balanceDate: "2026-11-01" };
  const result = formToAccountBody(form);
  expect(result).toEqual({
    body: {
      owner: "RUTH",
      name: "Nubank",
      type: "checking",
      institution: null,
      last4: null,
      initial_balance_cents: 123456,
      initial_balance_date: "2026-11-01",
      closing_day: null,
      due_day: null,
      active: true,
    },
  });
});

it("cartão aceita dias; outros tipos ignoram", () => {
  const card = { ...emptyAccountForm("RUTH"), name: "Cartão", type: "credit_card" as const, balance: "0", closingDay: "5", dueDay: "12", last4: "1234" };
  expect(formToAccountBody(card)).toMatchObject({ body: { closing_day: 5, due_day: 12, last4: "1234", initial_balance_cents: 0 } });
  expect(formToAccountBody({ ...card, closingDay: "40" })).toMatchObject({ errors: { closingDay: expect.any(String) } });
  expect(formToAccountBody({ ...card, type: "checking" })).toMatchObject({ body: { closing_day: null, due_day: null } });
});

it("erros por campo e empréstimo exige saldo negativo", () => {
  expect(formToAccountBody(emptyAccountForm("RUTH"))).toMatchObject({
    errors: { name: expect.any(String), balance: expect.any(String) },
  });
  const loan = { ...emptyAccountForm("MATHEUS"), name: "Empréstimo", type: "loan" as const, balance: "5.000,00" };
  expect(formToAccountBody(loan)).toMatchObject({ errors: { balance: expect.stringContaining("negativo") } });
  expect(formToAccountBody({ ...loan, balance: "-5.000,00" })).toMatchObject({ body: { initial_balance_cents: -500000 } });
  expect(formToAccountBody({ ...loan, balance: "0" })).toMatchObject({ body: { initial_balance_cents: 0 } });
});

it("conta -> formulário de edição", () => {
  const form = accountToForm({
    id: 1,
    owner: "MATHEUS",
    created_by: 1,
    name: "Caixa",
    type: "loan",
    initial_balance_cents: -500000,
    initial_balance_date: "2026-01-01",
    active: false,
    current_balance_cents: -500000,
  });
  expect(form).toMatchObject({ balance: "-5000,00", owner: "MATHEUS", active: false, institution: "" });
});
