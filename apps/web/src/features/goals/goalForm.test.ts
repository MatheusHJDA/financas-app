import { expect, it } from "vitest";
import type { Goal } from "../accounts/shared";
import { emptyGoalForm, formatPercent, formToGoalBody, goalToForm, progressText } from "./goalForm";

const base = (over: Partial<Goal>): Goal => ({
  id: 1,
  owner: "AMBOS",
  type: "accumulate",
  name: "Reserva",
  target_cents: 500_000,
  active: true,
  progress: { current_cents: 120_000, target_cents: 500_000, percent: 24, level: null },
  ...over,
});

it("progresso: 'R$ 1.200 de R$ 5.000 · 24%'", () => {
  expect(progressText(base({}))).toBe("R$ 1.200 de R$ 5.000 · 24%");
  expect(
    progressText(base({ progress: { current_cents: 11_050, target_cents: 13_000, percent: 84.62, level: "Piso" } })),
  ).toBe("R$ 110,50 de R$ 130 · 84,6%");
  expect(formatPercent(0.29)).toBe("0,2");
  expect(formatPercent(130)).toBe("130");
});

it("acumular: conta vinculada opcional, alvo em centavos", () => {
  const form = { ...emptyGoalForm("AMBOS"), name: "Reserva", target: "5.000,00", linkedAccountId: "3", dueDate: "2027-06-30" };
  expect(formToGoalBody(form)).toEqual({
    body: {
      owner: "AMBOS",
      type: "accumulate",
      name: "Reserva",
      target_cents: 500_000,
      period: null,
      levels: null,
      due_date: "2027-06-30",
      linked_account_id: 3,
      linked_category_id: null,
      active: true,
    },
  });
});

it("receita por período: níveis Piso/Meta/Desafio em centavos", () => {
  const form = {
    ...emptyGoalForm("MATHEUS"),
    type: "income_period" as const,
    name: "Uber diário",
    target: "130,00",
    floor: "100,00",
    challenge: "160,00",
    linkedCategoryId: "15",
  };
  expect(formToGoalBody(form)).toMatchObject({
    body: {
      type: "income_period",
      period: "daily",
      target_cents: 13_000,
      linked_category_id: 15,
      levels: [
        { name: "Piso", target_cents: 10_000 },
        { name: "Meta", target_cents: 13_000 },
        { name: "Desafio", target_cents: 16_000 },
      ],
    },
  });
  expect(formToGoalBody({ ...form, floor: "130,00" })).toMatchObject({ errors: { floor: expect.any(String) } });
  expect(formToGoalBody({ ...form, challenge: "100,00" })).toMatchObject({ errors: { challenge: expect.any(String) } });
  expect(formToGoalBody({ ...form, linkedCategoryId: "" })).toMatchObject({ errors: { linkedCategoryId: expect.any(String) } });
});

it("teto de gasto exige categoria; quitar dívida aceita alvo em branco", () => {
  const cap = { ...emptyGoalForm("RUTH"), type: "category_cap" as const, name: "iFood", target: "400,00" };
  expect(formToGoalBody(cap)).toMatchObject({ errors: { linkedCategoryId: expect.any(String) } });
  expect(formToGoalBody({ ...cap, linkedCategoryId: "10" })).toMatchObject({
    body: { linked_category_id: 10, target_cents: 40_000, levels: null, period: null },
  });
  const debt = { ...emptyGoalForm("MATHEUS"), type: "debt_payoff" as const, name: "Quitar empréstimo" };
  expect(formToGoalBody(debt)).toMatchObject({ body: { target_cents: 0 } });
  expect(formToGoalBody({ ...debt, type: "accumulate" })).toMatchObject({ errors: { target: expect.any(String) } });
});

it("meta -> formulário de edição recupera Piso e Desafio", () => {
  const form = goalToForm(
    base({
      type: "income_period",
      period: "weekly",
      target_cents: 13_000,
      linked_category_id: 15,
      levels: [
        { name: "Piso", target_cents: 10_000 },
        { name: "Meta", target_cents: 13_000 },
        { name: "Desafio", target_cents: 16_000 },
      ],
    }),
  );
  expect(form).toMatchObject({ period: "weekly", target: "130,00", floor: "100,00", challenge: "160,00", linkedCategoryId: "15" });
});
