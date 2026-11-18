"""Fixtures do painel admin: usuários com PIN real (argon2) e clientes com cookie de sessão."""

from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from finance_api.auth import service
from finance_api.core.config import Settings, get_settings
from finance_api.core.deps import get_current_user
from finance_api.db.models import User

# PINs fictícios, só para os testes.
PIN_MATHEUS = "123456"
PIN_RUTH = "654321"
NEW_PIN = "246810"


@pytest.fixture
def real_users(db: Session) -> dict[str, User]:
    matheus = User(name="Matheus", role="admin", pin_hash=service.hash_pin(PIN_MATHEUS))
    ruth = User(name="Ruth", role="member", pin_hash=service.hash_pin(PIN_RUTH))
    db.add_all([matheus, ruth])
    db.flush()
    return {"matheus": matheus, "ruth": ruth}


@pytest.fixture
def new_client(app: FastAPI) -> Callable[[], TestClient]:
    """Cada chamada devolve um cliente com cookie jar próprio (um "aparelho"), sem simulação."""
    app.dependency_overrides.pop(get_current_user, None)
    return lambda: TestClient(app, base_url="https://testserver")


@pytest.fixture
def login(
    real_users: dict[str, User], new_client: Callable[[], TestClient]
) -> Callable[..., TestClient]:
    pins = {"matheus": PIN_MATHEUS, "ruth": PIN_RUTH}

    def _login(who: str, pin: str | None = None) -> TestClient:
        client = new_client()
        response = client.post(
            "/api/auth/login",
            json={
                "name": real_users[who].name,
                "pin": pin or pins[who],
                "device_label": "Aparelho de teste",
            },
        )
        assert response.status_code == 200, response.text
        return client

    return _login


@pytest.fixture
def backup_dir(app: FastAPI, tmp_path: Path) -> Path:
    """Pasta temporária de backups injetada nas configurações."""
    folder = tmp_path / "backups"
    folder.mkdir()
    app.dependency_overrides[get_settings] = lambda: Settings(backup_dir=str(folder))
    return folder
