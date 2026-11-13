"""Motor puro da projeção do Plano (U10). Porta a aba Projeção da planilha v2.

Sem banco e sem FastAPI: recebe premissas, devolve a projeção. Dinheiro em centavos inteiros;
juros e parcela (PMT) em Decimal, arredondados meio-para-cima ao centavo. Nunca float.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, localcontext
from typing import Literal

Scenario = Literal["amortize_now", "no_amortization"]


@dataclass(frozen=True)
class CardInstallment:
    name: str
    installment_cents: int
    count: int
    first_month: int  # 1 = start_month


@dataclass(frozen=True)
class Assumptions:
    start_month: date  # dia 1
    months: int
    salary_cents: int
    other_income_cents: int
    uber_monthly_cents: int
    uber_fuel_percent: int
    fixed_bills_cents: int
    daily_expenses_cents: int
    contingency_cents: int
    health_plan_cents: int
    card_installments: tuple[CardInstallment, ...]
    loan_principal_cents: int
    loan_monthly_rate: Decimal
    loan_installments: int
    loan_balance_cents: int
    initial_amortization_cents: int
    cash_now_cents: int
    upfront_payments_cents: int
    reserve_minimum_cents: int


@dataclass(frozen=True)
class PlanMonth:
    month: date
    income_cents: int
    expense_cents: int
    loan_payment_cents: int
    interest_cents: int
    amortization_cents: int
    debt_balance_cents: int
    reserve_cents: int


@dataclass(frozen=True)
class Projection:
    scenario: Scenario
    months: tuple[PlanMonth, ...]
    payoff_month: date | None
    total_interest_cents: int
    interest_without_amortization_cents: int
    interest_saved_cents: int
    waiting_cost_per_month_cents: int


def round_cents(value: Decimal) -> int:
    """Meio-para-cima ao centavo (valores positivos, que são os que aparecem aqui)."""
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def monthly_payment_cents(principal_cents: int, rate: Decimal, installments: int) -> int:
    """PMT da tabela Price: P × r / (1 − (1+r)^−n), arredondada ao centavo."""
    if rate == 0:
        return round_cents(Decimal(principal_cents) / Decimal(installments))
    with localcontext() as ctx:
        ctx.prec = 50
        factor = (1 + rate) ** -installments
        pmt = Decimal(principal_cents) * rate / (1 - factor)
    return round_cents(pmt)


def add_months(first: date, offset: int) -> date:
    index = first.year * 12 + (first.month - 1) + offset
    return date(index // 12, index % 12 + 1, 1)


def _cards_due(cards: tuple[CardInstallment, ...], month_index: int) -> int:
    return sum(
        card.installment_cents
        for card in cards
        if card.first_month <= month_index <= card.first_month + card.count - 1
    )


def project(a: Assumptions, scenario: Scenario) -> Projection:
    amortize = scenario == "amortize_now"
    rate = a.loan_monthly_rate
    payment_pmt = monthly_payment_cents(a.loan_principal_cents, rate, a.loan_installments)

    if amortize:
        debt = a.loan_balance_cents - a.initial_amortization_cents
        cash = a.cash_now_cents - a.upfront_payments_cents - a.initial_amortization_cents
    else:
        debt = a.loan_balance_cents
        cash = a.cash_now_cents - a.upfront_payments_cents

    fuel_cents = round_cents(Decimal(a.uber_monthly_cents) * a.uber_fuel_percent / 100)
    income_cents = a.salary_cents + a.other_income_cents + a.uber_monthly_cents

    rows: list[PlanMonth] = []
    payoff: date | None = None
    total_interest = 0
    for m in range(1, a.months + 1):
        month = add_months(a.start_month, m - 1)
        interest = round_cents(Decimal(debt) * rate)
        payment = min(payment_pmt, debt + interest)
        health = a.health_plan_cents if debt == 0 else 0
        expense = (
            a.fixed_bills_cents
            + _cards_due(a.card_installments, m)
            + a.daily_expenses_cents
            + fuel_cents
            + a.contingency_cents
            + health
            + payment
        )
        balance_after_payment = debt + interest - payment
        cash_before = cash + income_cents - expense
        if amortize:
            extra = max(0, min(cash_before - a.reserve_minimum_cents, balance_after_payment))
        else:
            extra = 0
        debt = balance_after_payment - extra
        cash = cash_before - extra
        total_interest += interest
        if payoff is None and debt == 0:
            payoff = month
        rows.append(
            PlanMonth(
                month=month,
                income_cents=income_cents,
                expense_cents=expense,
                loan_payment_cents=payment,
                interest_cents=interest,
                amortization_cents=extra,
                debt_balance_cents=debt,
                reserve_cents=cash,
            )
        )

    interest_without = payment_pmt * a.loan_installments - a.loan_principal_cents
    return Projection(
        scenario=scenario,
        months=tuple(rows),
        payoff_month=payoff,
        total_interest_cents=total_interest,
        interest_without_amortization_cents=interest_without,
        # Economia só existe ao amortizar; sem amortizar a projeção é truncada em `months`
        # e a diferença viraria uma "economia" falsa.
        interest_saved_cents=(
            interest_without - total_interest if scenario == "amortize_now" else 0
        ),
        waiting_cost_per_month_cents=round_cents(Decimal(a.initial_amortization_cents) * rate),
    )
