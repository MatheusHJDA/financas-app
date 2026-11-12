"""Aba Geral: GET /overview (docs/api/openapi.yaml).

Decisões (contrato silencioso):
- `balances_by_owner` traz sempre os três grupos (RUTH, MATHEUS, AMBOS), só com contas ativas.
- `total_cents` por dono e `couple_total_cents` somam o dinheiro líquido: contas que não são
  cartão de crédito nem empréstimo. Faturas e dívidas aparecem à parte (campos próprios).
- Fatura aberta = saldo negativo do cartão (não há ciclo de fechamento; `due_date` é o próximo
  `due_day`). Saldo devedor = `current_balance_cents` das dívidas (tabela `debts`, U4) + soma de
  max(−saldo, 0) das contas `loan`. Cadastre cada empréstimo num lugar só (dívida OU conta
  `loan` com saldo inicial negativo), senão ele conta duas vezes.
- Contas a pagar: lê `bill_instances`/`recurring_bills` direto das tabelas (U4 é dona da escrita).
"""

import calendar
import datetime as dt
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select

from finance_api.accounts.schemas import AccountOut
from finance_api.accounts.service import compute_balances, to_out
from finance_api.core.deps import DbSession, get_current_user
from finance_api.core.permissions import CurrentUser, Owner
from finance_api.db.models import Account, BillInstance, Debt, RecurringBill

router = APIRouter(tags=["overview"])

User = Annotated[CurrentUser, Depends(get_current_user)]

UPCOMING_DAYS = 15
_NON_LIQUID = {"credit_card", "loan"}


class OwnerBalances(BaseModel):
    owner: Owner
    accounts: list[AccountOut]
    total_cents: int


class CardInvoice(BaseModel):
    account_id: int
    account_name: str
    open_amount_cents: int
    due_date: dt.date | None = None


class BillInstanceOut(BaseModel):
    id: int
    recurring_bill_id: int
    name: str | None = None
    owner: Owner | None = None
    month: dt.date
    due_date: dt.date
    amount_cents: int
    status: Literal["open", "paid"]
    paid_transaction_id: int | None = None


class Overview(BaseModel):
    balances_by_owner: list[OwnerBalances]
    couple_total_cents: int
    open_card_invoices: list[CardInvoice]
    debts_balance_cents: int
    upcoming_bills: list[BillInstanceOut]
    overdue_bills: list[BillInstanceOut]


def today_sao_paulo() -> dt.date:
    try:
        tz: dt.tzinfo = ZoneInfo("America/Sao_Paulo")
    except ZoneInfoNotFoundError:  # sem tzdata (ex.: Windows): o Brasil não tem horário de verão
        tz = dt.timezone(dt.timedelta(hours=-3))
    return dt.datetime.now(tz).date()


def _next_due_date(today: dt.date, due_day: int | None) -> dt.date | None:
    if due_day is None:
        return None
    year, month = today.year, today.month
    day = min(due_day, calendar.monthrange(year, month)[1])
    if day < today.day:
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
        day = min(due_day, calendar.monthrange(year, month)[1])
    return dt.date(year, month, day)


def _bill_out(bill: BillInstance, recurring: RecurringBill) -> BillInstanceOut:
    return BillInstanceOut(
        id=bill.id,
        recurring_bill_id=bill.recurring_bill_id,
        name=recurring.name,
        owner=Owner(recurring.owner),
        month=bill.month,
        due_date=bill.due_date,
        amount_cents=bill.amount_cents,
        status=bill.status,
        paid_transaction_id=bill.paid_transaction_id,
    )


def _open_bills(db: DbSession, *conditions) -> list[BillInstanceOut]:
    stmt = (
        select(BillInstance, RecurringBill)
        .join(RecurringBill, RecurringBill.id == BillInstance.recurring_bill_id)
        .where(BillInstance.status == "open", *conditions)
        .order_by(BillInstance.due_date, BillInstance.id)
    )
    return [_bill_out(bill, recurring) for bill, recurring in db.execute(stmt)]


@router.get("/overview", response_model=Overview)
def get_overview(db: DbSession, _user: User) -> Overview:
    today = today_sao_paulo()
    accounts = list(
        db.scalars(
            select(Account).where(Account.active.is_(True)).order_by(Account.name, Account.id)
        )
    )
    balances = compute_balances(db, [a.id for a in accounts])

    groups: list[OwnerBalances] = []
    for owner in (Owner.RUTH, Owner.MATHEUS, Owner.AMBOS):
        owned = [a for a in accounts if a.owner == owner]
        groups.append(
            OwnerBalances(
                owner=owner,
                accounts=[to_out(a, balances[a.id]) for a in owned],
                total_cents=sum(balances[a.id] for a in owned if a.type not in _NON_LIQUID),
            )
        )

    invoices = [
        CardInvoice(
            account_id=a.id,
            account_name=a.name,
            open_amount_cents=-balances[a.id],
            due_date=_next_due_date(today, a.due_day),
        )
        for a in accounts
        if a.type == "credit_card" and balances[a.id] < 0
    ]
    debts = sum(-balances[a.id] for a in accounts if a.type == "loan" and balances[a.id] < 0)
    debts += db.scalar(select(func.coalesce(func.sum(Debt.current_balance_cents), 0))) or 0

    return Overview(
        balances_by_owner=groups,
        couple_total_cents=sum(g.total_cents for g in groups),
        open_card_invoices=invoices,
        debts_balance_cents=debts,
        upcoming_bills=_open_bills(
            db,
            BillInstance.due_date >= today,
            BillInstance.due_date <= today + dt.timedelta(days=UPCOMING_DAYS),
        ),
        overdue_bills=_open_bills(db, BillInstance.due_date < today),
    )
