from datetime import date

import pytest
from sqlalchemy.orm import Session

from finance_api.core.permissions import CurrentUser
from finance_api.db.models import Account, Category, RecurringBill


@pytest.fixture
def account(db: Session, users: dict[str, CurrentUser]) -> Account:
    row = Account(
        owner="AMBOS",
        created_by=users["matheus"].id,
        name="Conta corrente",
        type="checking",
        initial_balance_cents=0,
        initial_balance_date=date(2026, 1, 1),
    )
    db.add(row)
    db.flush()
    return row


@pytest.fixture
def category(db: Session) -> Category:
    row = Category(name="Moradia", kind="expense")
    db.add(row)
    db.flush()
    return row


@pytest.fixture
def make_bill(db: Session):
    def _make(**kw) -> RecurringBill:
        data = {
            "owner": "AMBOS",
            "name": "Condomínio",
            "amount_cents": 18000,
            "due_day": 10,
            "start_month": date(2026, 1, 1),
        }
        data.update(kw)
        row = RecurringBill(**data)
        db.add(row)
        db.flush()
        return row

    return _make
