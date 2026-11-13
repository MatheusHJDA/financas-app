"""Loader do seed. Não cria usuários nem contas bancárias (D5); pula o que já existe (por nome)."""

from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from finance_api.bills.service import ensure_bill_instances, first_of_month, today_sp
from finance_api.core.audit import record_audit
from finance_api.core.permissions import Owner
from finance_api.db.models import Category, Debt, Goal, RecurringBill


def _default_seed_path() -> Path:
    """No repositório: <raiz>/infra/seed/seed.yaml. Na imagem Docker (/app/src/...), a pasta é
    rasa demais para isso; lá o arquivo vem de SEED_FILE (/app/seed/seed.yaml)."""
    parents = Path(__file__).resolve().parents
    if len(parents) > 5:
        return parents[5] / "infra" / "seed" / "seed.yaml"
    return Path("/app/seed/seed.yaml")


DEFAULT_SEED_PATH = _default_seed_path()


class _Level(BaseModel):
    name: str
    target_cents: int


class _Category(BaseModel):
    name: str
    kind: str
    is_recurring_card_allowed: bool = False


class _Bill(BaseModel):
    name: str
    owner: Owner
    amount_cents: int = Field(gt=0)
    due_day: int = Field(ge=1, le=31)
    category: str | None = None
    payment_method: str | None = Field(default=None, max_length=40)


class _Debt(BaseModel):
    name: str
    owner: Owner
    principal_cents: int
    monthly_rate: Decimal
    installments: int
    installment_cents: int
    start_date: date
    current_balance_cents: int


class _Goal(BaseModel):
    name: str
    owner: Owner
    type: str
    target_cents: int
    period: str | None = None
    due_date: date | None = None
    category: str | None = None
    levels: list[_Level] | None = None


class SeedFile(BaseModel):
    categories: list[_Category] = []
    recurring_bills: list[_Bill] = []
    debts: list[_Debt] = []
    goals: list[_Goal] = []


Counts = dict[str, tuple[int, int]]


def _audit(db: Session, entity: str, row: Any, after: dict[str, Any]) -> None:
    record_audit(db, user_id=None, entity=entity, entity_id=row.id, action="create", after=after)


def load_seed(db: Session, path: Path = DEFAULT_SEED_PATH, *, today: date | None = None) -> Counts:
    """Aplica o seed na sessão (flush, sem commit). Devolve {seção: (criados, já existiam)}."""
    data = SeedFile.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")) or {})
    today = today or today_sp()
    counts: Counts = {}

    created = skipped = 0
    for item in data.categories:
        exists = db.scalar(
            select(Category.id).where(Category.name == item.name, Category.kind == item.kind)
        )
        if exists is not None:
            skipped += 1
            continue
        row = Category(**item.model_dump())
        db.add(row)
        db.flush()
        _audit(db, "categories", row, item.model_dump())
        created += 1
    counts["categories"] = (created, skipped)

    def category_id(name: str | None) -> int | None:
        if name is None:
            return None
        found = db.scalar(select(Category.id).where(Category.name == name))
        if found is None:
            raise ValueError(f"seed: categoria inexistente: {name}")
        return found

    created = skipped = 0
    start = first_of_month(today)
    for item in data.recurring_bills:
        if db.scalar(select(RecurringBill.id).where(RecurringBill.name == item.name)):
            skipped += 1
            continue
        row = RecurringBill(
            name=item.name,
            owner=item.owner.value,
            amount_cents=item.amount_cents,
            due_day=item.due_day,
            start_month=start,
            category_id=category_id(item.category),
            payment_method=item.payment_method,
        )
        db.add(row)
        db.flush()
        _audit(
            db,
            "recurring_bills",
            row,
            {
                "name": row.name,
                "owner": row.owner,
                "amount_cents": row.amount_cents,
                "due_day": row.due_day,
                "start_month": row.start_month.isoformat(),
                "category_id": row.category_id,
                "payment_method": row.payment_method,
            },
        )
        created += 1
    counts["recurring_bills"] = (created, skipped)
    if created:
        ensure_bill_instances(db, today)

    created = skipped = 0
    for item in data.debts:
        if db.scalar(select(Debt.id).where(Debt.name == item.name)):
            skipped += 1
            continue
        row = Debt(**item.model_dump(exclude={"owner"}), owner=item.owner.value)
        db.add(row)
        db.flush()
        _audit(db, "debts", row, item.model_dump(mode="json"))
        created += 1
    counts["debts"] = (created, skipped)

    created = skipped = 0
    for item in data.goals:
        if db.scalar(select(Goal.id).where(Goal.name == item.name)):
            skipped += 1
            continue
        row = Goal(
            name=item.name,
            owner=item.owner.value,
            type=item.type,
            target_cents=item.target_cents,
            period=item.period,
            due_date=item.due_date,
            linked_category_id=category_id(item.category),
            levels_json=[lv.model_dump() for lv in item.levels] if item.levels else None,
        )
        db.add(row)
        db.flush()
        _audit(db, "goals", row, item.model_dump(mode="json"))
        created += 1
    counts["goals"] = (created, skipped)
    return counts
