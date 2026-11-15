"""Schemas de GET /reports/month (docs/api/openapi.yaml: MonthReport e filhos)."""

import datetime as dt

from pydantic import BaseModel


class MonthTotals(BaseModel):
    income_cents: int
    expense_cents: int


class MonthBills(BaseModel):
    total_count: int
    paid_count: int
    paid_cents: int
    open_count: int
    open_cents: int


class CategoryShare(BaseModel):
    category_id: int | None
    name: str
    total_cents: int
    share_bp: int


class DailyPoint(BaseModel):
    day: int
    cents: int


class DailyCumulative(BaseModel):
    current: list[DailyPoint]
    previous: list[DailyPoint]


class MonthReport(BaseModel):
    month: dt.date
    income_cents: int
    expense_cents: int
    balance_cents: int
    bills: MonthBills
    previous: MonthTotals
    expense_delta_cents: int
    by_category: list[CategoryShare]
    daily_cumulative_expense: DailyCumulative
