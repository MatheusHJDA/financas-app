"""GET /reports/month (docs/api/openapi.yaml).

Mesmas regras de leitura de `GET /transactions`: qualquer usuário autenticado lê o casal inteiro
(ou filtra por `owner`); não há 403 aqui. "Hoje" é a data de São Paulo.
"""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from finance_api.bills.service import ensure_bill_instances, ensure_upcoming_bill_instances
from finance_api.core.deps import DbSession, get_current_user
from finance_api.core.permissions import CurrentUser, Owner
from finance_api.overview.router import today_sao_paulo
from finance_api.reports.schemas import MonthReport
from finance_api.reports.service import build_month_report

router = APIRouter(tags=["reports"])

User = Annotated[CurrentUser, Depends(get_current_user)]

MonthParam = Annotated[str, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", description="AAAA-MM")]


@router.get("/reports/month", response_model=MonthReport)
def get_month_report(
    db: DbSession, _user: User, month: MonthParam, owner: Owner | None = None
) -> MonthReport:
    year, mon = month.split("-")
    try:
        first = dt.date(int(year), int(mon), 1)
    except ValueError as exc:  # ex.: ano 0000 passa no pattern
        raise HTTPException(status_code=422, detail="Mês inválido.") from exc
    today = today_sao_paulo()
    created = ensure_upcoming_bill_instances(db, today)  # virada do mês: contas do mês já aparecem
    # Mês futuro (até 12 meses): gera as contas fixas dele, senão "A pagar" vem zerado.
    horizon = dt.date(today.year + 1, today.month, 1)
    if today.replace(day=1) < first <= horizon:
        created += ensure_bill_instances(db, first)
    if created:
        db.commit()
    return build_month_report(db, first, owner, today)
