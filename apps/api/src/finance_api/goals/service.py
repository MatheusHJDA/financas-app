"""Progresso automático das metas (ORQUESTRACAO.md 6.4). Dinheiro sempre em centavos inteiros.

Tipos:
- accumulate: acumular valor. Com conta vinculada, o progresso é o saldo atual dessa conta;
  sem conta vinculada, é a soma dos aportes (goal_entries).
- debt_payoff: quitar dívida. Progresso = principal - saldo devedor das dívidas cujo nome
  casa com o da meta (o modelo não tem vínculo meta→dívida; ver handoff).
- income_period: soma das receitas da categoria vinculada (e subcategorias) no período
  corrente (daily/weekly/monthly); `levels` dão Piso/Meta/Desafio.
- category_cap: teto de gasto; progresso = gasto do mês na categoria (e subcategorias) vs teto.
"""

from datetime import date, timedelta
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from finance_api.db.models import Account, Category, Debt, Goal, GoalEntry, Transaction

GOAL_TYPES = ("accumulate", "debt_payoff", "income_period", "category_cap")
INCOME_PERIODS = ("daily", "weekly", "monthly")


def period_range(period: str | None, today: date) -> tuple[date, date]:
    """Intervalo [início, fim] (inclusive) do período corrente."""
    if period == "daily":
        return today, today
    if period == "weekly":
        start = today - timedelta(days=today.weekday())  # segunda-feira
        return start, start + timedelta(days=6)
    start = today.replace(day=1)
    next_month = (start + timedelta(days=32)).replace(day=1)
    return start, next_month - timedelta(days=1)


def _category_ids(db: Session, category_id: int) -> list[int]:
    children = db.scalars(select(Category.id).where(Category.parent_id == category_id)).all()
    return [category_id, *children]


def _sum_by_kind(
    db: Session, kind: str, category_id: int, start: date, end: date, owner: str = "AMBOS"
) -> int:
    """Soma do período na categoria. Meta individual conta só o dono e o que é dos dois."""
    conditions = [
        Transaction.kind == kind,
        Transaction.category_id.in_(_category_ids(db, category_id)),
        Transaction.date >= start,
        Transaction.date <= end,
    ]
    if owner != "AMBOS":
        conditions.append(Transaction.owner.in_([owner, "AMBOS"]))
    total = db.scalar(
        select(func.coalesce(func.sum(Transaction.amount_cents), 0)).where(*conditions)
    )
    return int(total or 0)


def account_balance(db: Session, account: Account) -> int:
    """Saldo = inicial + lançamentos desde initial_balance_date (entradas − saídas)."""
    delta_main = db.scalar(
        select(
            func.coalesce(
                func.sum(
                    case(
                        (Transaction.kind == "income", Transaction.amount_cents),
                        else_=-Transaction.amount_cents,
                    )
                ),
                0,
            )
        ).where(
            Transaction.account_id == account.id,
            Transaction.date >= account.initial_balance_date,
        )
    )
    incoming = db.scalar(
        select(func.coalesce(func.sum(Transaction.amount_cents), 0)).where(
            Transaction.kind == "transfer",
            Transaction.to_account_id == account.id,
            Transaction.date >= account.initial_balance_date,
        )
    )
    return int(account.initial_balance_cents + (delta_main or 0) + (incoming or 0))


def _matching_debts(db: Session, goal: Goal) -> list[Debt]:
    name = goal.name.casefold()
    return [d for d in db.scalars(select(Debt)).all() if d.name.casefold() in name]


def _percent(current: int, target: int) -> float:
    if target <= 0:
        return 0.0
    return round(current * 100 / target, 2)


def _level_reached(levels: list[dict[str, Any]] | None, current: int) -> str | None:
    reached = [lv for lv in levels or [] if current >= lv["target_cents"]]
    if not reached:
        return None
    return max(reached, key=lambda lv: lv["target_cents"])["name"]


def compute_progress(db: Session, goal: Goal, today: date) -> dict[str, Any]:
    target = goal.target_cents
    current = 0
    if goal.type == "accumulate":
        account = db.get(Account, goal.linked_account_id) if goal.linked_account_id else None
        if account is not None:
            current = account_balance(db, account)
        else:
            current = int(
                db.scalar(
                    select(func.coalesce(func.sum(GoalEntry.amount_cents), 0)).where(
                        GoalEntry.goal_id == goal.id
                    )
                )
                or 0
            )
    elif goal.type == "debt_payoff":
        debts = _matching_debts(db, goal)
        principal = sum(d.principal_cents for d in debts)
        balance = sum(d.current_balance_cents for d in debts)
        current = max(0, principal - balance)
        if target <= 0:
            target = principal
    elif goal.type == "income_period" and goal.linked_category_id:
        start, end = period_range(goal.period, today)
        current = _sum_by_kind(db, "income", goal.linked_category_id, start, end, goal.owner)
    elif goal.type == "category_cap" and goal.linked_category_id:
        start, end = period_range("monthly", today)
        current = _sum_by_kind(db, "expense", goal.linked_category_id, start, end, goal.owner)
    return {
        "current_cents": current,
        "target_cents": target,
        "percent": _percent(current, target),
        "level": _level_reached(goal.levels_json, current),
    }
