"""Categorias (docs/api/openapi.yaml).

Categorias não têm dono: são compartilhadas pelo casal, então qualquer usuário autenticado pode
criar/editar/excluir (equivale a um registro AMBOS em `ensure_can_write`).
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, StrictBool, StrictInt, StringConstraints
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from finance_api.core.audit import record_audit
from finance_api.core.deps import DbSession, get_current_user
from finance_api.core.permissions import CurrentUser, Owner, ensure_can_write
from finance_api.db.models import Category, Goal, RecurringBill, Transaction

router = APIRouter(tags=["categories"])

User = Annotated[CurrentUser, Depends(get_current_user)]
CategoryKind = Literal["income", "expense"]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class CategoryCreate(BaseModel):
    name: Name
    kind: CategoryKind
    parent_id: StrictInt | None = None
    is_recurring_card_allowed: StrictBool = False


class CategoryUpdate(BaseModel):
    name: Name | None = None
    kind: CategoryKind | None = None
    parent_id: StrictInt | None = None
    is_recurring_card_allowed: StrictBool | None = None


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    kind: CategoryKind
    parent_id: int | None
    is_recurring_card_allowed: bool


class CategoryPage(BaseModel):
    items: list[CategoryOut]
    total: int


def _snapshot(category: Category) -> dict:
    return {
        "name": category.name,
        "kind": category.kind,
        "parent_id": category.parent_id,
        "is_recurring_card_allowed": category.is_recurring_card_allowed,
    }


def _get_or_404(db: DbSession, category_id: int) -> Category:
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Categoria não encontrada.")
    return category


def _check_parent(db: DbSession, parent_id: int | None, own_id: int | None = None) -> None:
    """Pai precisa existir e não pode formar ciclo (inclusive consigo mesma)."""
    if parent_id is None:
        return
    seen: set[int] = set()
    current: int | None = parent_id
    while current is not None:
        if current == own_id or current in seen:
            raise HTTPException(422, "Categoria pai inválida (ciclo).")
        seen.add(current)
        parent = db.get(Category, current)
        if parent is None:
            raise HTTPException(422, "Categoria pai não encontrada.")
        current = parent.parent_id


@router.get("/categories", response_model=CategoryPage)
def list_categories(
    db: DbSession,
    _user: User,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> CategoryPage:
    total = db.scalar(select(func.count()).select_from(Category)) or 0
    rows = db.scalars(select(Category).order_by(Category.id).limit(limit).offset(offset)).all()
    return CategoryPage(items=[CategoryOut.model_validate(c) for c in rows], total=total)


@router.post("/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(body: CategoryCreate, db: DbSession, user: User) -> CategoryOut:
    ensure_can_write(user, Owner.AMBOS)
    _check_parent(db, body.parent_id)
    category = Category(
        name=body.name.strip(),
        kind=body.kind,
        parent_id=body.parent_id,
        is_recurring_card_allowed=body.is_recurring_card_allowed,
    )
    db.add(category)
    db.flush()
    record_audit(
        db,
        user_id=user.id,
        entity="categories",
        entity_id=category.id,
        action="create",
        after=_snapshot(category),
    )
    db.commit()
    return CategoryOut.model_validate(category)


@router.patch("/categories/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: int, body: CategoryUpdate, db: DbSession, user: User
) -> CategoryOut:
    category = _get_or_404(db, category_id)
    ensure_can_write(user, Owner.AMBOS)
    changes = {name: getattr(body, name) for name in body.model_fields_set}
    for name in {"name", "kind", "is_recurring_card_allowed"} & changes.keys():
        if changes[name] is None:
            raise HTTPException(422, f"'{name}' não pode ser nulo.")
    if "parent_id" in changes:
        _check_parent(db, changes["parent_id"], own_id=category.id)

    before = _snapshot(category)
    for name, value in changes.items():
        setattr(category, name, value.strip() if name == "name" else value)
    db.flush()
    record_audit(
        db,
        user_id=user.id,
        entity="categories",
        entity_id=category.id,
        action="update",
        before=before,
        after=_snapshot(category),
    )
    db.commit()
    return CategoryOut.model_validate(category)


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: int, db: DbSession, user: User) -> Response:
    category = _get_or_404(db, category_id)
    ensure_can_write(user, Owner.AMBOS)
    in_use = db.scalar(
        select(Transaction.id).where(Transaction.category_id == category.id).limit(1)
    )
    if in_use is None:
        in_use = db.scalar(
            select(Category.id).where(Category.parent_id == category.id).limit(1)
        ) or db.scalar(
            select(RecurringBill.id).where(RecurringBill.category_id == category.id).limit(1)
        )
    if in_use is None:
        in_use = db.scalar(select(Goal.id).where(Goal.linked_category_id == category.id).limit(1))
    if in_use is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "A categoria está em uso.")

    before = _snapshot(category)
    db.delete(category)
    record_audit(
        db,
        user_id=user.id,
        entity="categories",
        entity_id=category.id,
        action="delete",
        before=before,
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "A categoria está em uso.") from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
