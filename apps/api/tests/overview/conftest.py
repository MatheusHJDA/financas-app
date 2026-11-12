"""Fábricas de contas/categorias/lançamentos gravados direto no banco de teste."""

import datetime as dt
from collections.abc import Callable

import pytest
from sqlalchemy.orm import Session

from finance_api.core.permissions import CurrentUser
from finance_api.db.models import Account, Category, Transaction


@pytest.fixture
def make_account(db: Session, users: dict[str, CurrentUser]) -> Callable[..., Account]:
    def _make(
        name: str = "Conta",
        type: str = "checking",
        owner: str = "MATHEUS",
        initial: int = 0,
        initial_date: dt.date = dt.date(2026, 1, 1),
        **extra,
    ) -> Account:
        account = Account(
            owner=owner,
            created_by=users["matheus"].id,
            name=name,
            type=type,
            initial_balance_cents=initial,
            initial_balance_date=initial_date,
            **extra,
        )
        db.add(account)
        db.flush()
        return account

    return _make


@pytest.fixture
def make_category(db: Session) -> Callable[..., Category]:
    def _make(
        name: str = "Mercado", kind: str = "expense", card_ok: bool = False, parent_id=None
    ) -> Category:
        category = Category(
            name=name, kind=kind, is_recurring_card_allowed=card_ok, parent_id=parent_id
        )
        db.add(category)
        db.flush()
        return category

    return _make


@pytest.fixture
def make_tx(db: Session, users: dict[str, CurrentUser]) -> Callable[..., Transaction]:
    def _make(
        account: Account,
        kind: str = "expense",
        amount: int = 1000,
        date: dt.date = dt.date(2026, 3, 10),
        description: str = "Lançamento",
        to_account: Account | None = None,
        category: Category | None = None,
        owner: str = "MATHEUS",
    ) -> Transaction:
        tx = Transaction(
            kind=kind,
            amount_cents=amount,
            date=date,
            description=description,
            account_id=account.id,
            to_account_id=to_account.id if to_account else None,
            category_id=category.id if category else None,
            owner=owner,
            created_by=users["matheus"].id,
            status="confirmed",
            source="manual",
        )
        db.add(tx)
        db.flush()
        return tx

    return _make
