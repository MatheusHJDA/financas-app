from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from finance_api.bills.service import today_sp
from finance_api.core.audit import record_audit
from finance_api.core.deps import DbSession, get_current_user
from finance_api.core.permissions import CurrentUser, Owner, ensure_can_write
from finance_api.db.models import Account, Category, Goal, GoalEntry, Transaction
from finance_api.goals.service import GOAL_TYPES, INCOME_PERIODS, compute_progress

router = APIRouter(tags=["goals"])

User = Annotated[CurrentUser, Depends(get_current_user)]
Limit = Annotated[int, Query(ge=1, le=200)]
Offset = Annotated[int, Query(ge=0)]


class GoalLevel(BaseModel):
    name: str = Field(min_length=1)
    target_cents: int = Field(ge=0)


class GoalProgress(BaseModel):
    current_cents: int
    target_cents: int
    percent: float
    level: str | None = None


class GoalOut(BaseModel):
    id: int
    owner: Owner
    type: str
    name: str
    target_cents: int
    period: str | None = None
    levels: list[GoalLevel] | None = None
    due_date: date | None = None
    linked_account_id: int | None = None
    linked_category_id: int | None = None
    active: bool
    progress: GoalProgress


class GoalCreate(BaseModel):
    owner: Owner
    type: str
    name: str = Field(min_length=1, max_length=120)
    target_cents: int = Field(ge=0)
    period: str | None = Field(default=None, max_length=20)
    levels: list[GoalLevel] | None = None
    due_date: date | None = None
    linked_account_id: int | None = None
    linked_category_id: int | None = None
    active: bool = True


class GoalUpdate(BaseModel):
    owner: Owner | None = None
    type: str | None = None
    name: str | None = Field(default=None, min_length=1, max_length=120)
    target_cents: int | None = Field(default=None, ge=0)
    period: str | None = Field(default=None, max_length=20)
    levels: list[GoalLevel] | None = None
    due_date: date | None = None
    linked_account_id: int | None = None
    linked_category_id: int | None = None
    active: bool | None = None


class GoalPage(BaseModel):
    items: list[GoalOut]
    total: int


class GoalEntryCreate(BaseModel):
    amount_cents: int = Field(gt=0)
    date: date
    transaction_id: int | None = None


class GoalEntryOut(BaseModel):
    id: int
    goal_id: int
    amount_cents: int
    date: date
    transaction_id: int | None = None


def _out(db: DbSession, goal: Goal) -> GoalOut:
    return GoalOut(
        id=goal.id,
        owner=Owner(goal.owner),
        type=goal.type,
        name=goal.name,
        target_cents=goal.target_cents,
        period=goal.period,
        levels=[GoalLevel(**lv) for lv in goal.levels_json] if goal.levels_json else None,
        due_date=goal.due_date,
        linked_account_id=goal.linked_account_id,
        linked_category_id=goal.linked_category_id,
        active=goal.active,
        progress=GoalProgress(**compute_progress(db, goal, today_sp())),
    )


def _snap(goal: Goal) -> dict:
    return {
        "id": goal.id,
        "owner": goal.owner,
        "type": goal.type,
        "name": goal.name,
        "target_cents": goal.target_cents,
        "period": goal.period,
        "levels": goal.levels_json,
        "due_date": goal.due_date.isoformat() if goal.due_date else None,
        "linked_account_id": goal.linked_account_id,
        "linked_category_id": goal.linked_category_id,
        "active": goal.active,
    }


def _get(db: DbSession, id: int) -> Goal:
    goal = db.get(Goal, id)
    if goal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Meta não encontrada.")
    return goal


def _unprocessable(message: str) -> HTTPException:
    return HTTPException(422, message)


def _validate(db: DbSession, goal: Goal) -> None:
    if goal.type not in GOAL_TYPES:
        raise _unprocessable(f"Tipo de meta inválido. Use: {', '.join(GOAL_TYPES)}.")
    if goal.type == "income_period":
        if goal.period not in INCOME_PERIODS:
            raise _unprocessable("Meta de receita exige period: daily, weekly ou monthly.")
        if goal.linked_category_id is None:
            raise _unprocessable("Meta de receita exige linked_category_id.")
    if goal.type == "category_cap" and goal.linked_category_id is None:
        raise _unprocessable("Teto de gasto exige linked_category_id.")
    if goal.linked_account_id is not None and db.get(Account, goal.linked_account_id) is None:
        raise _unprocessable("Conta vinculada inexistente.")
    if goal.linked_category_id is not None and db.get(Category, goal.linked_category_id) is None:
        raise _unprocessable("Categoria vinculada inexistente.")


def _levels_json(levels: list[GoalLevel] | None) -> list[dict] | None:
    return [lv.model_dump() for lv in levels] if levels else None


@router.get("/goals", response_model=GoalPage)
def list_goals(db: DbSession, user: User, limit: Limit = 50, offset: Offset = 0) -> GoalPage:
    total = db.scalar(select(func.count()).select_from(Goal)) or 0
    rows = db.scalars(select(Goal).order_by(Goal.id).limit(limit).offset(offset)).all()
    return GoalPage(items=[_out(db, g) for g in rows], total=total)


@router.post("/goals", response_model=GoalOut, status_code=201)
def create_goal(body: GoalCreate, db: DbSession, user: User) -> GoalOut:
    ensure_can_write(user, body.owner)
    goal = Goal(
        **body.model_dump(exclude={"owner", "levels"}),
        owner=body.owner.value,
        levels_json=_levels_json(body.levels),
    )
    _validate(db, goal)
    db.add(goal)
    db.flush()
    record_audit(
        db, user_id=user.id, entity="goals", entity_id=goal.id, action="create", after=_snap(goal)
    )
    db.commit()
    return _out(db, goal)


@router.get("/goals/{id}", response_model=GoalOut)
def get_goal(id: int, db: DbSession, user: User) -> GoalOut:
    return _out(db, _get(db, id))


@router.patch("/goals/{id}", response_model=GoalOut)
def update_goal(id: int, body: GoalUpdate, db: DbSession, user: User) -> GoalOut:
    goal = _get(db, id)
    ensure_can_write(user, Owner(goal.owner))
    before = _snap(goal)
    data = body.model_dump(exclude_unset=True)
    for key in ("owner", "type", "name", "target_cents", "active"):
        if key in data and data[key] is None:
            raise _unprocessable(f"{key} não pode ser nulo.")
    if "owner" in data:
        ensure_can_write(user, Owner(data["owner"]))
        goal.owner = Owner(data["owner"]).value
    if "levels" in data:
        goal.levels_json = _levels_json(body.levels)
    for key, value in data.items():
        if key not in ("owner", "levels"):
            setattr(goal, key, value)
    _validate(db, goal)
    db.flush()
    record_audit(
        db,
        user_id=user.id,
        entity="goals",
        entity_id=goal.id,
        action="update",
        before=before,
        after=_snap(goal),
    )
    db.commit()
    return _out(db, goal)


@router.delete("/goals/{id}", status_code=204)
def delete_goal(id: int, db: DbSession, user: User) -> Response:
    goal = _get(db, id)
    ensure_can_write(user, Owner(goal.owner))
    before = _snap(goal)
    db.delete(goal)  # goal_entries saem por CASCADE no banco
    record_audit(db, user_id=user.id, entity="goals", entity_id=id, action="delete", before=before)
    db.commit()
    return Response(status_code=204)


@router.post("/goals/{id}/entries", response_model=GoalEntryOut, status_code=201)
def create_goal_entry(id: int, body: GoalEntryCreate, db: DbSession, user: User) -> GoalEntryOut:
    goal = _get(db, id)
    ensure_can_write(user, Owner(goal.owner))
    if body.transaction_id is not None and db.get(Transaction, body.transaction_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lançamento não encontrado.")
    entry = GoalEntry(
        goal_id=goal.id,
        amount_cents=body.amount_cents,
        date=body.date,
        transaction_id=body.transaction_id,
    )
    db.add(entry)
    db.flush()
    out = GoalEntryOut(
        id=entry.id,
        goal_id=goal.id,
        amount_cents=entry.amount_cents,
        date=entry.date,
        transaction_id=entry.transaction_id,
    )
    record_audit(
        db,
        user_id=user.id,
        entity="goal_entries",
        entity_id=entry.id,
        action="create",
        after=out.model_dump(mode="json"),
    )
    db.commit()
    return out
