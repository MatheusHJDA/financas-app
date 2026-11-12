"""Fixtures do módulo de autenticação (PINs reais com argon2, relógio simulado)."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from finance_api.auth import service
from finance_api.core.deps import get_current_user, require_admin
from finance_api.core.permissions import CurrentUser
from finance_api.db.models import User

# PINs fictícios, só para os testes.
PIN_MATHEUS = "123456"
PIN_RUTH = "654321"


@dataclass
class Clock:
    now: datetime

    def advance(self, **kwargs: float) -> None:
        self.now += timedelta(**kwargs)


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    fake = Clock(now=datetime.now(UTC))
    monkeypatch.setattr(service, "utcnow", lambda: fake.now)
    return fake


@pytest.fixture
def auth_users(db: Session) -> dict[str, User]:
    """Matheus (admin) e Ruth (member) com PIN real (argon2)."""
    matheus = User(name="Matheus", role="admin", pin_hash=service.hash_pin(PIN_MATHEUS))
    ruth = User(name="Ruth", role="member", pin_hash=service.hash_pin(PIN_RUTH))
    db.add_all([matheus, ruth])
    db.flush()
    return {"matheus": matheus, "ruth": ruth}


@pytest.fixture
def new_client(app: FastAPI) -> Callable[[], TestClient]:
    """Cada chamada devolve um cliente com cookie jar próprio (um "aparelho").

    https: o cookie é Secure e não seria reenviado por um cliente http.
    """
    app.dependency_overrides.pop(get_current_user, None)

    @app.get("/_teste/admin")
    def _admin_only(user: CurrentUser = Depends(require_admin)) -> dict[str, str]:  # noqa: B008
        return {"name": user.name}

    return lambda: TestClient(app, base_url="https://testserver")


@pytest.fixture
def login(
    auth_users: dict[str, User], new_client: Callable[[], TestClient]
) -> Callable[..., TestClient]:
    """login("ruth", device="iPhone") → cliente já autenticado."""
    pins = {"matheus": PIN_MATHEUS, "ruth": PIN_RUTH}

    def _login(who: str, device: str = "Aparelho de teste") -> TestClient:
        client = new_client()
        response = client.post(
            "/api/auth/login",
            json={"user_id": auth_users[who].id, "pin": pins[who], "device_label": device},
        )
        assert response.status_code == 200, response.text
        return client

    return _login
