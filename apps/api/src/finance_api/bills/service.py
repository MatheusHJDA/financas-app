"""Regras de contas a pagar: geração das instâncias mensais e datas (America/Sao_Paulo)."""

import calendar
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from finance_api.db.models import BillInstance, RecurringBill

TZ = ZoneInfo("America/Sao_Paulo")


def today_sp() -> date:
    """Data de hoje no fuso de São Paulo."""
    return datetime.now(TZ).date()


def first_of_month(value: date) -> date:
    return value.replace(day=1)


def due_date_for(month: date, due_day: int) -> date:
    """Dia de vencimento no mês; dia inexistente (ex.: 31 em fevereiro) vira o último dia."""
    last = calendar.monthrange(month.year, month.month)[1]
    return date(month.year, month.month, min(due_day, last))


def ensure_bill_instances(db: Session, month: date) -> int:
    """Gera as instâncias de `month` (qualquer dia do mês) que ainda não existem.

    Idempotente: único por (recurring_bill_id, month). Respeita start_month/end_month e usa
    due_day (limitado ao último dia do mês). Faz flush, não commit (o chamador decide).
    Devolve quantas instâncias foram criadas agora.
    """
    month = first_of_month(month)
    bills = db.scalars(
        select(RecurringBill).where(
            RecurringBill.start_month <= month,
            or_(RecurringBill.end_month.is_(None), RecurringBill.end_month >= month),
        )
    ).all()
    created = 0
    for bill in bills:
        stmt = (
            pg_insert(BillInstance)
            .values(
                recurring_bill_id=bill.id,
                month=month,
                due_date=due_date_for(month, bill.due_day),
                amount_cents=bill.amount_cents,
                status="open",
            )
            .on_conflict_do_nothing(index_elements=["recurring_bill_id", "month"])
            .returning(BillInstance.id)
        )
        if db.execute(stmt).first() is not None:
            created += 1
    db.flush()
    return created
