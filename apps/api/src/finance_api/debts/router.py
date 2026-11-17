from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import exists, func, select

from finance_api.bills.service import today_sp
from finance_api.core.audit import record_audit
from finance_api.core.deps import DbSession, get_current_user
from finance_api.core.permissions import CurrentUser, Owner, ensure_can_write
from finance_api.db.models import Debt, DebtInstallment, RecurringBill
from finance_api.debts.installments import loan_summary, pay_installments
from finance_api.debts.schemas import (
    DebtCreate,
    DebtOut,
    DebtPage,
    DebtUpdate,
    InstallmentOut,
    LoanSummaryOut,
    PayInstallmentsIn,
)

router = APIRouter(tags=["debts"])

User = Annotated[CurrentUser, Depends(get_current_user)]
Limit = Annotated[int, Query(ge=1, le=200)]
Offset = Annotated[int, Query(ge=0)]

# Com parcelas, saldo e valor da parcela vêm delas: não se editam à mão.
_DERIVED = ("current_balance_cents", "installment_cents")


def _snap(debt: Debt) -> dict:
    return DebtOut.model_validate(debt).model_dump(mode="json", exclude={"has_installments"})


def _has_installments(db: DbSession, debt_id: int) -> bool:
    return bool(db.scalar(select(exists().where(DebtInstallment.debt_id == debt_id))))


def _out(db: DbSession, debt: Debt) -> DebtOut:
    out = DebtOut.model_validate(debt)
    out.has_installments = _has_installments(db, debt.id)
    return out


def _get(db: DbSession, id: int) -> Debt:
    debt = db.get(Debt, id)
    if debt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dívida não encontrada.")
    return debt


@router.get("/debts", response_model=DebtPage)
def list_debts(db: DbSession, user: User, limit: Limit = 50, offset: Offset = 0) -> DebtPage:
    total = db.scalar(select(func.count()).select_from(Debt)) or 0
    rows = db.scalars(select(Debt).order_by(Debt.id).limit(limit).offset(offset)).all()
    with_installments = set(
        db.scalars(
            select(DebtInstallment.debt_id)
            .where(DebtInstallment.debt_id.in_([r.id for r in rows]))
            .distinct()
        )
    )
    items = []
    for r in rows:
        out = DebtOut.model_validate(r)
        out.has_installments = r.id in with_installments
        items.append(out)
    return DebtPage(items=items, total=total)


@router.post("/debts", response_model=DebtOut, status_code=201)
def create_debt(body: DebtCreate, db: DbSession, user: User) -> DebtOut:
    ensure_can_write(user, body.owner)
    debt = Debt(**body.model_dump(exclude={"owner"}), owner=body.owner.value)
    db.add(debt)
    db.flush()
    record_audit(
        db, user_id=user.id, entity="debts", entity_id=debt.id, action="create", after=_snap(debt)
    )
    db.commit()
    return _out(db, debt)


@router.get("/debts/{id}", response_model=DebtOut)
def get_debt(id: int, db: DbSession, user: User) -> DebtOut:
    return _out(db, _get(db, id))


def _sync_bill(db: DbSession, user: CurrentUser, debt: Debt) -> None:
    """A conta fixa das parcelas segue o dono e o nome da dívida (ela não se edita à mão)."""
    bill = db.scalar(select(RecurringBill).where(RecurringBill.debt_id == debt.id))
    if bill is None or (bill.owner, bill.name) == (debt.owner, debt.name):
        return
    before = {"owner": bill.owner, "name": bill.name}
    bill.owner = debt.owner
    bill.name = debt.name
    db.flush()
    record_audit(
        db,
        user_id=user.id,
        entity="recurring_bills",
        entity_id=bill.id,
        action="update",
        before=before,
        after={"owner": bill.owner, "name": bill.name},
    )


@router.patch("/debts/{id}", response_model=DebtOut)
def update_debt(id: int, body: DebtUpdate, db: DbSession, user: User) -> DebtOut:
    debt = _get(db, id)
    ensure_can_write(user, Owner(debt.owner))
    before = _snap(debt)
    data = body.model_dump(exclude_unset=True)
    for key, value in data.items():
        if value is None:
            raise HTTPException(422, f"{key} não pode ser nulo.")
    if any(key in data for key in _DERIVED) and _has_installments(db, debt.id):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Saldo e valor da parcela vêm das parcelas do empréstimo; não podem ser alterados.",
        )
    if "owner" in data:
        ensure_can_write(user, Owner(data["owner"]))
        data["owner"] = Owner(data["owner"]).value
    for key, value in data.items():
        setattr(debt, key, value)
    db.flush()
    _sync_bill(db, user, debt)
    record_audit(
        db,
        user_id=user.id,
        entity="debts",
        entity_id=debt.id,
        action="update",
        before=before,
        after=_snap(debt),
    )
    db.commit()
    return _out(db, debt)


@router.delete("/debts/{id}", status_code=204)
def delete_debt(id: int, db: DbSession, user: User) -> Response:
    debt = _get(db, id)
    ensure_can_write(user, Owner(debt.owner))
    if _has_installments(db, debt.id):
        # As parcelas (e a conta fixa delas) prendem a dívida; sem isso o banco recusaria com 500.
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Dívida com parcelas cadastradas não pode ser excluída."
        )
    before = _snap(debt)
    db.delete(debt)
    record_audit(db, user_id=user.id, entity="debts", entity_id=id, action="delete", before=before)
    db.commit()
    return Response(status_code=204)


def _summary_out(db: DbSession, debt: Debt) -> LoanSummaryOut:
    summary = loan_summary(db, debt, today_sp())
    if not summary.items:
        # Dívida sem parcelas: só o saldo informado à mão.
        return LoanSummaryOut(
            remaining_cents=debt.current_balance_cents,
            paid_cents=0,
            payoff_today_cents=0,
            items=[],
        )
    return LoanSummaryOut(
        remaining_cents=summary.remaining_cents,
        paid_cents=summary.paid_cents,
        payoff_today_cents=summary.payoff_today_cents,
        items=[InstallmentOut.model_validate(i) for i in summary.items],
    )


@router.get("/debts/{id}/installments", response_model=LoanSummaryOut)
def get_installments(id: int, db: DbSession, user: User) -> LoanSummaryOut:
    return _summary_out(db, _get(db, id))


@router.post("/debts/{id}/installments/pay", response_model=LoanSummaryOut)
def pay_debt_installments(
    id: int, body: PayInstallmentsIn, db: DbSession, user: User
) -> LoanSummaryOut:
    """Paga ou adianta parcelas com uma única despesa no valor realmente cobrado."""
    debt = _get(db, id)
    ensure_can_write(user, Owner(debt.owner))
    pay_installments(
        db, user, debt, body.installment_ids, body.amount_cents, body.account_id, body.date
    )
    db.commit()
    return _summary_out(db, debt)
