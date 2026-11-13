// Formulário "Editar premissas": texto dos campos <-> PlanAssumptions (centavos e taxa decimal).
import {
  centsToField,
  isoToMonthInput,
  monthInputToIso,
  parseMoneyInput,
  parsePercentInput,
  rateToPercentText,
} from "./planMath";
import type { PlanAssumptions } from "./planApi";

export interface CardRow {
  name: string;
  installment: string;
  count: string;
  firstMonth: string;
}

export interface PlanForm {
  startMonth: string; // AAAA-MM
  months: string;
  salary: string;
  otherIncome: string;
  uberMonthly: string;
  uberFuelPercent: string;
  fixedBills: string;
  dailyExpenses: string;
  contingency: string;
  healthPlan: string;
  cards: CardRow[];
  loanPrincipal: string;
  loanRatePercent: string;
  loanInstallments: string;
  loanBalance: string;
  initialAmortization: string;
  cashNow: string;
  upfrontPayments: string;
  reserveMinimum: string;
}

/** Erros por campo. Chaves = nomes do PlanForm; cartões: "cards.<índice>.<campo>". */
export type FieldErrors = Record<string, string>;

export const MAX_CARDS = 20;
const MONEY_HINT = "Informe em reais, por exemplo 1.234,56. Use 0 se não houver.";

export function toForm(a: PlanAssumptions): PlanForm {
  return {
    startMonth: isoToMonthInput(a.start_month),
    months: String(a.months),
    salary: centsToField(a.salary_cents),
    otherIncome: centsToField(a.other_income_cents),
    uberMonthly: centsToField(a.uber_monthly_cents),
    uberFuelPercent: String(a.uber_fuel_percent),
    fixedBills: centsToField(a.fixed_bills_cents),
    dailyExpenses: centsToField(a.daily_expenses_cents),
    contingency: centsToField(a.contingency_cents),
    healthPlan: centsToField(a.health_plan_cents),
    cards: a.card_installments.map((c) => ({
      name: c.name,
      installment: centsToField(c.installment_cents),
      count: String(c.count),
      firstMonth: String(c.first_month),
    })),
    loanPrincipal: centsToField(a.loan_principal_cents),
    loanRatePercent: rateToPercentText(a.loan_monthly_rate),
    loanInstallments: String(a.loan_installments),
    loanBalance: centsToField(a.loan_balance_cents),
    initialAmortization: centsToField(a.initial_amortization_cents),
    cashNow: centsToField(a.cash_now_cents),
    upfrontPayments: centsToField(a.upfront_payments_cents),
    reserveMinimum: centsToField(a.reserve_minimum_cents),
  };
}

/** Número inteiro dentro de [min, max] ou null. */
function intIn(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= min && n <= max ? n : null;
}

export function fromForm(f: PlanForm): { value: PlanAssumptions } | { errors: FieldErrors } {
  const errors: FieldErrors = {};
  const money = (key: keyof PlanForm, allowNegative = false): number => {
    const cents = parseMoneyInput(f[key] as string, allowNegative);
    if (cents === null) errors[key] = MONEY_HINT;
    return cents ?? 0;
  };
  const int = (key: keyof PlanForm, min: number, max: number, hint: string): number => {
    const n = intIn(f[key] as string, min, max);
    if (n === null) errors[key] = hint;
    return n ?? 0;
  };

  const startIso = monthInputToIso(f.startMonth);
  if (!startIso) errors.startMonth = "Escolha o mês inicial.";

  const rate = parsePercentInput(f.loanRatePercent);
  if (rate === null) errors.loanRatePercent = "Informe a taxa ao mês em %, entre 0 e 100. Por exemplo 3,45.";

  const cards: PlanAssumptions["card_installments"] = [];
  if (f.cards.length > MAX_CARDS) errors.cards = `Use no máximo ${MAX_CARDS} parcelas de cartão.`;
  f.cards.forEach((row, i) => {
    const name = row.name.trim();
    if (!name || name.length > 120) errors[`cards.${i}.name`] = "Informe o nome, com até 120 letras.";
    const installment = parseMoneyInput(row.installment);
    if (installment === null) errors[`cards.${i}.installment`] = MONEY_HINT;
    const count = intIn(row.count, 1, 120);
    if (count === null) errors[`cards.${i}.count`] = "Parcelas restantes: número de 1 a 120.";
    const firstMonth = intIn(row.firstMonth, 1, 1000);
    if (firstMonth === null) errors[`cards.${i}.firstMonth`] = "Mês da 1ª parcela: 1 é o mês inicial.";
    cards.push({
      name,
      installment_cents: installment ?? 0,
      count: count ?? 0,
      first_month: firstMonth ?? 1,
    });
  });

  const value: PlanAssumptions = {
    start_month: startIso ?? "",
    months: int("months", 1, 60, "Meses da projeção: de 1 a 60."),
    salary_cents: money("salary"),
    other_income_cents: money("otherIncome"),
    uber_monthly_cents: money("uberMonthly"),
    uber_fuel_percent: int("uberFuelPercent", 0, 100, "Use um número de 0 a 100."),
    fixed_bills_cents: money("fixedBills"),
    daily_expenses_cents: money("dailyExpenses"),
    contingency_cents: money("contingency"),
    health_plan_cents: money("healthPlan"),
    card_installments: cards,
    loan_principal_cents: money("loanPrincipal"),
    loan_monthly_rate: rate ?? "0",
    loan_installments: int("loanInstallments", 1, 360, "Número de parcelas: de 1 a 360."),
    loan_balance_cents: money("loanBalance"),
    initial_amortization_cents: money("initialAmortization"),
    cash_now_cents: money("cashNow", true),
    upfront_payments_cents: money("upfrontPayments"),
    reserve_minimum_cents: money("reserveMinimum"),
  };

  if (value.initial_amortization_cents > value.loan_balance_cents) {
    errors.initialAmortization = "A amortização inicial não pode passar do saldo devedor.";
  }

  return Object.keys(errors).length > 0 ? { errors } : { value };
}
