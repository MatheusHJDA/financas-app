"""Relatório do mês (GET /reports/month).

Tudo em centavos inteiros (sem float), agregado no banco. Regras de leitura idênticas às de
`GET /transactions` (mesmo `_apply_filters`): o relatório só soma o que o usuário já pode listar.
Transferências (`kind == "transfer"`) ficam fora de receita, despesa e categorias.
"""

import calendar
import datetime as dt

from sqlalchemy import Select, case, func, select
from sqlalchemy.orm import Session

from finance_api.core.permissions import Owner
from finance_api.db.models import BillInstance, Category, RecurringBill, Transaction
from finance_api.reports.schemas import (
    CategoryShare,
    DailyCumulative,
    DailyPoint,
    MonthBills,
    MonthReport,
    MonthTotals,
)
from finance_api.transactions.router import Filters, _apply_filters

NO_CATEGORY = "Sem categoria"


def _month_bounds(month: dt.date) -> tuple[dt.date, dt.date]:
    first = month.replace(day=1)
    return first, first.replace(day=calendar.monthrange(first.year, first.month)[1])


def _previous_month(first: dt.date) -> dt.date:
    return (first - dt.timedelta(days=1)).replace(day=1)


def _tx_stmt(stmt: Select, first: dt.date, last: dt.date, owner: Owner | None, kind: str) -> Select:
    return _apply_filters(stmt, Filters(owner=owner, kind=kind, date_from=first, date_to=last))


def _sum_by_kind(db: Session, first: dt.date, owner: Owner | None, kind: str) -> int:
    first, last = _month_bounds(first)
    stmt = _tx_stmt(
        select(func.coalesce(func.sum(Transaction.amount_cents), 0)), first, last, owner, kind
    )
    return int(db.scalar(stmt) or 0)


def _totals(db: Session, first: dt.date, owner: Owner | None) -> MonthTotals:
    return MonthTotals(
        income_cents=_sum_by_kind(db, first, owner, "income"),
        expense_cents=_sum_by_kind(db, first, owner, "expense"),
    )


def _share_bp(part: int, whole: int) -> int:
    """Participação em pontos-base (1% = 100), meio-para-cima, só com inteiros. Total 0 → 0."""
    if whole <= 0:
        return 0
    return (part * 20000 + whole) // (2 * whole)


def _by_category(
    db: Session, first: dt.date, last: dt.date, owner: Owner | None, expense: int
) -> list[CategoryShare]:
    stmt = _tx_stmt(
        select(Transaction.category_id, Category.name, func.sum(Transaction.amount_cents))
        .select_from(Transaction)
        .outerjoin(Category, Category.id == Transaction.category_id),
        first,
        last,
        owner,
        "expense",
    ).group_by(Transaction.category_id, Category.name)
    rows = [
        (category_id, name or NO_CATEGORY, int(amount))
        for category_id, name, amount in db.execute(stmt)
    ]
    rows.sort(key=lambda r: (-r[2], r[1], -1 if r[0] is None else r[0]))
    return [
        CategoryShare(
            category_id=category_id,
            name=name,
            total_cents=amount,
            share_bp=_share_bp(amount, expense),
        )
        for category_id, name, amount in rows
    ]


def _bills(db: Session, first: dt.date, owner: Owner | None) -> MonthBills:
    # Conta paga vale o que saiu de fato (lançamento vinculado); sem ele, o valor da instância.
    settled = case(
        (
            BillInstance.status == "paid",
            func.coalesce(Transaction.amount_cents, BillInstance.amount_cents),
        ),
        else_=BillInstance.amount_cents,
    )
    stmt = (
        select(
            BillInstance.status, func.count(BillInstance.id), func.coalesce(func.sum(settled), 0)
        )
        .select_from(BillInstance)
        .outerjoin(Transaction, Transaction.id == BillInstance.paid_transaction_id)
        .where(BillInstance.month == first)
    )
    if owner is not None:
        stmt = stmt.join(RecurringBill, RecurringBill.id == BillInstance.recurring_bill_id).where(
            RecurringBill.owner == owner.value
        )
    rows = db.execute(stmt.group_by(BillInstance.status))
    by_status = {status: (count, int(cents)) for status, count, cents in rows}
    paid_count, paid_cents = by_status.get("paid", (0, 0))
    open_count, open_cents = by_status.get("open", (0, 0))
    return MonthBills(
        total_count=paid_count + open_count,
        paid_count=paid_count,
        paid_cents=paid_cents,
        open_count=open_count,
        open_cents=open_cents,
    )


def _cumulative(db: Session, month: dt.date, owner: Owner | None, days: int) -> list[DailyPoint]:
    """Despesa acumulada dos dias 1..days do mês; dia sem gasto repete o acumulado."""
    first, last = _month_bounds(month)
    stmt = _tx_stmt(
        select(Transaction.date, func.sum(Transaction.amount_cents)), first, last, owner, "expense"
    ).group_by(Transaction.date)
    per_day = {day: int(cents) for day, cents in db.execute(stmt)}
    points: list[DailyPoint] = []
    running = 0
    for day in range(1, days + 1):
        running += per_day.get(first.replace(day=day), 0)
        points.append(DailyPoint(day=day, cents=running))
    return points


def build_month_report(
    db: Session, month: dt.date, owner: Owner | None, today: dt.date
) -> MonthReport:
    """Monta o relatório de `month` (qualquer dia do mês) para `owner` (None = casal).

    `today` (data de hoje no fuso de SP) limita o acumulado diário do mês corrente; mês futuro
    devolve `current` vazio e mês passado devolve `current` completo. `previous` é sempre o mês
    anterior completo. Contas fixas respeitam `owner` (dono da conta fixa).

    `share_bp` é a participação da categoria na despesa do mês em pontos-base (1% = 100),
    arredondada meio-para-cima por categoria; por isso a soma das participações pode não dar
    exatamente 10000.
    """
    first, last = _month_bounds(month)
    prev_first = _previous_month(first)
    totals = _totals(db, first, owner)
    previous = _totals(db, prev_first, owner)

    if today < first:
        current_days = 0
    elif today > last:
        current_days = last.day
    else:
        current_days = today.day

    return MonthReport(
        month=first,
        income_cents=totals.income_cents,
        expense_cents=totals.expense_cents,
        balance_cents=totals.income_cents - totals.expense_cents,
        bills=_bills(db, first, owner),
        previous=previous,
        expense_delta_cents=totals.expense_cents - previous.expense_cents,
        by_category=_by_category(db, first, last, owner, totals.expense_cents),
        daily_cumulative_expense=DailyCumulative(
            current=_cumulative(db, first, owner, current_days),
            previous=_cumulative(db, prev_first, owner, _month_bounds(prev_first)[1].day),
        ),
    )
