"""Contrato de /plan/* (PlanAssumptions, PlanProjection). U10.

Valores em centavos; taxa como texto decimal entre 0 e 1 (ex.: "0.0345").
Campos extras são recusados (422) para não gravar premissa que o front não mostra.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from finance_api.plan.engine import Assumptions, CardInstallment, PlanMonth, Projection

MAX_CENTS = 99_999_999_999  # R$ 999.999.999,99 (mesmo limite do front)
Cents = Annotated[int, Field(ge=0, le=MAX_CENTS)]


class CardInstallmentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    installment_cents: Cents
    count: int = Field(ge=1, le=120, description="Parcelas restantes.")
    first_month: int = Field(
        ge=1, description="Índice do mês da primeira parcela (1 = start_month)."
    )


class PlanAssumptionsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_month: date
    months: int = Field(ge=1, le=60)
    salary_cents: Cents
    other_income_cents: Cents
    uber_monthly_cents: Cents
    uber_fuel_percent: int = Field(ge=0, le=100)
    fixed_bills_cents: Cents
    daily_expenses_cents: Cents
    contingency_cents: Cents
    health_plan_cents: Cents
    card_installments: list[CardInstallmentIn] = Field(max_length=20)
    loan_principal_cents: Cents
    loan_monthly_rate: str = Field(min_length=1, max_length=12)
    loan_installments: int = Field(ge=1, le=360)
    loan_balance_cents: Cents
    initial_amortization_cents: Cents
    cash_now_cents: Annotated[int, Field(ge=-MAX_CENTS, le=MAX_CENTS)]
    upfront_payments_cents: Cents
    reserve_minimum_cents: Cents

    @field_validator("start_month")
    @classmethod
    def _first_day(cls, value: date) -> date:
        if value.day != 1:
            raise ValueError("deve ser o dia 1 do mês")
        return value

    @field_validator("loan_monthly_rate")
    @classmethod
    def _rate(cls, value: str) -> str:
        try:
            rate = Decimal(value.strip())
        except InvalidOperation as exc:
            raise ValueError("taxa deve ser decimal entre 0 e 1") from exc
        if not rate.is_finite() or rate < 0 or rate > 1:
            raise ValueError("taxa deve ser decimal entre 0 e 1")
        return format(rate.normalize(), "f")

    @model_validator(mode="after")
    def _amortization_fits_balance(self) -> PlanAssumptionsIn:
        if self.initial_amortization_cents > self.loan_balance_cents:
            raise ValueError("amortização inicial não pode passar do saldo devedor")
        return self


class PlanMonthOut(BaseModel):
    month: date
    income_cents: int
    expense_cents: int
    loan_payment_cents: int
    interest_cents: int
    amortization_cents: int
    debt_balance_cents: int
    reserve_cents: int

    @classmethod
    def from_engine(cls, row: PlanMonth) -> PlanMonthOut:
        return cls(
            month=row.month,
            income_cents=row.income_cents,
            expense_cents=row.expense_cents,
            loan_payment_cents=row.loan_payment_cents,
            interest_cents=row.interest_cents,
            amortization_cents=row.amortization_cents,
            debt_balance_cents=row.debt_balance_cents,
            reserve_cents=row.reserve_cents,
        )


class PlanProjectionOut(BaseModel):
    scenario: Literal["amortize_now", "no_amortization"]
    months: list[PlanMonthOut]
    payoff_month: date | None
    total_interest_cents: int
    interest_without_amortization_cents: int
    interest_saved_cents: int
    waiting_cost_per_month_cents: int

    @classmethod
    def from_engine(cls, proj: Projection) -> PlanProjectionOut:
        return cls(
            scenario=proj.scenario,
            months=[PlanMonthOut.from_engine(row) for row in proj.months],
            payoff_month=proj.payoff_month,
            total_interest_cents=proj.total_interest_cents,
            interest_without_amortization_cents=proj.interest_without_amortization_cents,
            interest_saved_cents=proj.interest_saved_cents,
            waiting_cost_per_month_cents=proj.waiting_cost_per_month_cents,
        )


def to_engine(p: PlanAssumptionsIn) -> Assumptions:
    return Assumptions(
        start_month=p.start_month,
        months=p.months,
        salary_cents=p.salary_cents,
        other_income_cents=p.other_income_cents,
        uber_monthly_cents=p.uber_monthly_cents,
        uber_fuel_percent=p.uber_fuel_percent,
        fixed_bills_cents=p.fixed_bills_cents,
        daily_expenses_cents=p.daily_expenses_cents,
        contingency_cents=p.contingency_cents,
        health_plan_cents=p.health_plan_cents,
        card_installments=tuple(
            CardInstallment(c.name, c.installment_cents, c.count, c.first_month)
            for c in p.card_installments
        ),
        loan_principal_cents=p.loan_principal_cents,
        loan_monthly_rate=Decimal(p.loan_monthly_rate),
        loan_installments=p.loan_installments,
        loan_balance_cents=p.loan_balance_cents,
        initial_amortization_cents=p.initial_amortization_cents,
        cash_now_cents=p.cash_now_cents,
        upfront_payments_cents=p.upfront_payments_cents,
        reserve_minimum_cents=p.reserve_minimum_cents,
    )
