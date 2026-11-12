from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_serializer
from sqlalchemy import func, select

from finance_api.core.audit import record_audit
from finance_api.core.deps import DbSession, get_current_user
from finance_api.core.permissions import CurrentUser, Owner, ensure_can_write
from finance_api.db.models import Debt

router = APIRouter(tags=["debts"])

User = Annotated[CurrentUser, Depends(get_current_user)]
Limit = Annotated[int, Query(ge=1, le=200)]
Offset = Annotated[int, Query(ge=0)]

Rate = Annotated[Decimal, Field(ge=0, lt=100, max_digits=8, decimal_places=6)]


class DebtOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner: Owner
    name: str
    principal_cents: int
    monthly_rate: Decimal  # fração decimal (0.0345 = 3,45% a.m.), serializada como string
    installments: int
    installment_cents: int
    start_date: date
    current_balance_cents: int

    @field_serializer("monthly_rate")
    def _rate_str(self, value: Decimal) -> str:
        return format(value.quantize(Decimal("0.000001")), "f")  # Numeric(8,6)


class DebtCreate(BaseModel):
    owner: Owner
    name: str = Field(min_length=1, max_length=120)
    principal_cents: int = Field(gt=0)
    monthly_rate: Rate
    installments: int = Field(ge=1)
    installment_cents: int = Field(ge=0)
    start_date: date
    current_balance_cents: int = Field(ge=0)


class DebtUpdate(BaseModel):
    owner: Owner | None = None
    name: str | None = Field(default=None, min_length=1, max_length=120)
    principal_cents: int | None = Field(default=None, gt=0)
    monthly_rate: Rate | None = None
    installments: int | None = Field(default=None, ge=1)
    installment_cents: int | None = Field(default=None, ge=0)
    start_date: date | None = None
    current_balance_cents: int | None = Field(default=None, ge=0)


class DebtPage(BaseModel):
    items: list[DebtOut]
    total: int


def _snap(debt: Debt) -> dict:
    return DebtOut.model_validate(debt).model_dump(mode="json")


def _get(db: DbSession, id: int) -> Debt:
    debt = db.get(Debt, id)
    if debt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dívida não encontrada.")
    return debt


@router.get("/debts", response_model=DebtPage)
def list_debts(db: DbSession, user: User, limit: Limit = 50, offset: Offset = 0) -> DebtPage:
    total = db.scalar(select(func.count()).select_from(Debt)) or 0
    rows = db.scalars(select(Debt).order_by(Debt.id).limit(limit).offset(offset)).all()
    return DebtPage(items=[DebtOut.model_validate(r) for r in rows], total=total)


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
    return DebtOut.model_validate(debt)


@router.get("/debts/{id}", response_model=DebtOut)
def get_debt(id: int, db: DbSession, user: User) -> DebtOut:
    return DebtOut.model_validate(_get(db, id))


@router.patch("/debts/{id}", response_model=DebtOut)
def update_debt(id: int, body: DebtUpdate, db: DbSession, user: User) -> DebtOut:
    debt = _get(db, id)
    ensure_can_write(user, Owner(debt.owner))
    before = _snap(debt)
    data = body.model_dump(exclude_unset=True)
    for key, value in data.items():
        if value is None:
            raise HTTPException(422, f"{key} não pode ser nulo.")
    if "owner" in data:
        ensure_can_write(user, Owner(data["owner"]))
        data["owner"] = Owner(data["owner"]).value
    for key, value in data.items():
        setattr(debt, key, value)
    db.flush()
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
    return DebtOut.model_validate(debt)


@router.delete("/debts/{id}", status_code=204)
def delete_debt(id: int, db: DbSession, user: User) -> Response:
    debt = _get(db, id)
    ensure_can_write(user, Owner(debt.owner))
    before = _snap(debt)
    db.delete(debt)
    record_audit(db, user_id=user.id, entity="debts", entity_id=id, action="delete", before=before)
    db.commit()
    return Response(status_code=204)
