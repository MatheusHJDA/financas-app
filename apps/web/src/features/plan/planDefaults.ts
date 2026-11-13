import type { PlanAssumptions } from "./planApi";

// Valores da aba Projeção da planilha v2. Cópia de apps/api/src/finance_api/plan/defaults.py:
// se mudar lá, mude aqui (usado só pelo botão "Voltar aos valores da planilha").
export const PLANILHA_DEFAULTS: PlanAssumptions = {
  start_month: "2026-12-01",
  months: 13,
  salary_cents: 300000,
  other_income_cents: 470000,
  uber_monthly_cents: 260000,
  uber_fuel_percent: 30,
  fixed_bills_cents: 379927,
  daily_expenses_cents: 110000,
  contingency_cents: 60000,
  health_plan_cents: 58000,
  card_installments: [
    { name: "Santander – Cama", installment_cents: 38524, count: 10, first_month: 1 },
    { name: "Santander – Jim", installment_cents: 28900, count: 2, first_month: 1 },
    { name: "Santander – Araguaia", installment_cents: 23500, count: 2, first_month: 1 },
    { name: "Sicredi – Midea", installment_cents: 27500, count: 10, first_month: 1 },
  ],
  loan_principal_cents: 2200000,
  loan_monthly_rate: "0.0345",
  loan_installments: 24,
  loan_balance_cents: 2200000,
  initial_amortization_cents: 800000,
  cash_now_cents: 1090000,
  upfront_payments_cents: 27500,
  reserve_minimum_cents: 200000,
};
