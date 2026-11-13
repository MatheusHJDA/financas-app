"""Contas/categorias fictícias, IA falsa e `upload_dir` em `tmp_path` para os testes da U5."""

import datetime as dt
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from finance_api.ai.client import get_ai_client
from finance_api.core.config import Settings, get_settings
from finance_api.core.permissions import CurrentUser
from finance_api.db.models import Account, Category, Transaction

from .fakes import FakeAiClient


@dataclass
class World:
    nubank_ruth: Account
    cartao_ruth: Account
    sonia: Account
    matheus: Account
    dinheiro: Account
    categories: dict[str, Category]


@pytest.fixture
def world(db: Session, users: dict[str, CurrentUser]) -> World:
    def account(name: str, type_: str, owner: str, last4: str | None = None) -> Account:
        row = Account(
            owner=owner,
            created_by=users["matheus"].id,
            name=name,
            type=type_,
            last4=last4,
            initial_balance_cents=0,
            initial_balance_date=dt.date(2026, 1, 1),
        )
        db.add(row)
        return row

    accounts = World(
        nubank_ruth=account("Nubank Ruth", "checking", "RUTH", "4321"),
        cartao_ruth=account("Cartão Nubank Ruth", "credit_card", "RUTH", "8899"),
        sonia=account("Sonia", "checking", "MATHEUS"),
        matheus=account("Matheus", "checking", "MATHEUS"),
        dinheiro=account("Dinheiro", "cash", "AMBOS"),
        categories={},
    )
    for name, kind, card_ok in (
        ("Mercado", "expense", False),
        ("Farmácia", "expense", False),
        ("Restaurante", "expense", False),
        ("Streaming", "expense", True),
        ("Luz", "expense", False),
        ("Salário", "income", False),
    ):
        category = Category(name=name, kind=kind, is_recurring_card_allowed=card_ok)
        db.add(category)
        accounts.categories[name] = category
    db.flush()
    return accounts


@pytest.fixture
def upload_dir(tmp_path: Path) -> Path:
    path = tmp_path / "uploads"
    path.mkdir()
    return path


@pytest.fixture
def settings(app: FastAPI, upload_dir: Path) -> Settings:
    value = Settings(_env_file=None, upload_dir=str(upload_dir), openai_api_key="", openai_model="")
    app.dependency_overrides[get_settings] = lambda: value
    return value


@pytest.fixture
def use_ai(app: FastAPI, settings: Settings) -> Callable[..., FakeAiClient]:
    """`use_ai("pix_sonia_matheus")` → a app passa a usar a IA falsa com essa fixture."""

    def _use(fixture: str | None = None, **kwargs) -> FakeAiClient:
        fake = FakeAiClient(fixture=fixture, **kwargs)
        app.dependency_overrides[get_ai_client] = lambda: fake
        return fake

    return _use


@pytest.fixture
def count_transactions(db: Session) -> Callable[[], int]:
    return lambda: db.scalar(select(func.count(Transaction.id))) or 0
