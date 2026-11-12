from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from finance_api.accounts.schemas import AccountCreate, AccountOut, AccountPage, AccountUpdate
from finance_api.accounts.service import audit_snapshot, compute_balances, to_out
from finance_api.core.audit import record_audit
from finance_api.core.deps import DbSession, get_current_user
from finance_api.core.permissions import CurrentUser, ensure_can_write
from finance_api.db.models import Account, RecurringBill, Transaction

router = APIRouter(tags=["accounts"])

User = Annotated[CurrentUser, Depends(get_current_user)]

# Campos que não aceitam null no PATCH (as demais colunas são opcionais).
_NOT_NULL = {"owner", "name", "type", "initial_balance_cents", "initial_balance_date", "active"}


def _get_or_404(db: DbSession, account_id: int) -> Account:
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conta não encontrada.")
    return account


def _out(db: DbSession, account: Account) -> AccountOut:
    return to_out(account, compute_balances(db, [account.id])[account.id])


@router.get("/accounts", response_model=AccountPage)
def list_accounts(
    db: DbSession,
    _user: User,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AccountPage:
    total = db.scalar(select(func.count()).select_from(Account)) or 0
    accounts = db.scalars(select(Account).order_by(Account.id).limit(limit).offset(offset)).all()
    balances = compute_balances(db, [a.id for a in accounts])
    return AccountPage(items=[to_out(a, balances[a.id]) for a in accounts], total=total)


@router.post("/accounts", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
def create_account(body: AccountCreate, db: DbSession, user: User) -> AccountOut:
    ensure_can_write(user, body.owner)
    account = Account(
        owner=body.owner.value,
        created_by=user.id,
        name=body.name.strip(),
        type=body.type,
        institution=body.institution,
        last4=body.last4,
        initial_balance_cents=body.initial_balance_cents,
        initial_balance_date=body.initial_balance_date,
        closing_day=body.closing_day,
        due_day=body.due_day,
        active=body.active,
    )
    db.add(account)
    db.flush()
    record_audit(
        db,
        user_id=user.id,
        entity="accounts",
        entity_id=account.id,
        action="create",
        after=audit_snapshot(account),
    )
    db.commit()
    return _out(db, account)


@router.get("/accounts/{account_id}", response_model=AccountOut)
def get_account(account_id: int, db: DbSession, _user: User) -> AccountOut:
    return _out(db, _get_or_404(db, account_id))


@router.patch("/accounts/{account_id}", response_model=AccountOut)
def update_account(account_id: int, body: AccountUpdate, db: DbSession, user: User) -> AccountOut:
    account = _get_or_404(db, account_id)
    ensure_can_write(user, account.owner)
    changes = {name: getattr(body, name) for name in body.model_fields_set}
    for name in _NOT_NULL & changes.keys():
        if changes[name] is None:
            raise HTTPException(422, f"'{name}' não pode ser nulo.")
    if "owner" in changes:
        ensure_can_write(user, changes["owner"])  # não dá para "doar" a conta a outro dono

    before = audit_snapshot(account)
    for name, value in changes.items():
        if name == "owner":
            value = value.value
        elif name == "name":
            value = value.strip()
        setattr(account, name, value)
    db.flush()
    record_audit(
        db,
        user_id=user.id,
        entity="accounts",
        entity_id=account.id,
        action="update",
        before=before,
        after=audit_snapshot(account),
    )
    db.commit()
    return _out(db, account)


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(account_id: int, db: DbSession, user: User) -> Response:
    account = _get_or_404(db, account_id)
    ensure_can_write(user, account.owner)
    in_use = db.scalar(
        select(Transaction.id)
        .where(or_(Transaction.account_id == account.id, Transaction.to_account_id == account.id))
        .limit(1)
    )
    if in_use is None:
        in_use = db.scalar(select(RecurringBill.id).where(RecurringBill.account_id == account.id))
    if in_use is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A conta tem lançamentos ou contas a pagar; inative-a."
        )

    before = audit_snapshot(account)
    db.delete(account)
    record_audit(
        db,
        user_id=user.id,
        entity="accounts",
        entity_id=account.id,
        action="delete",
        before=before,
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A conta está em uso por outros registros."
        ) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
