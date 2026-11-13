"""Fixtures compartilhadas (lead, Onda 1). Unidades não editam este arquivo.

Banco de teste: Postgres real (suba com `./tasks.ps1 testdb`). Cada checkout/worktree usa um
banco próprio, derivado do caminho de `apps/api`, recriado do zero e migrado (alembic head)
uma vez por sessão de testes. Cada teste roda numa transação desfeita no fim.

Testes sem banco não pedem estas fixtures e rodam sem Postgres.
Fixtures próprias de uma unidade ficam em `tests/<unidade>/conftest.py`.
"""

import hashlib
import os
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from alembic import command
from finance_api.core.deps import get_current_user
from finance_api.core.permissions import CurrentUser, Owner
from finance_api.db.models import User
from finance_api.db.session import get_db
from finance_api.main import create_app

API_DIR = Path(__file__).resolve().parents[1]
DEFAULT_ADMIN_URL = "postgresql+psycopg://financas_test:financas_test@127.0.0.1:55432/postgres"


def _test_db_name() -> str:
    tag = hashlib.sha1(str(API_DIR).lower().encode()).hexdigest()[:10]
    return f"financas_test_{tag}"


@pytest.fixture(scope="session")
def db_engine() -> Iterator[Engine]:
    admin_url = make_url(os.environ.get("TEST_DATABASE_ADMIN_URL", DEFAULT_ADMIN_URL))
    name = _test_db_name()
    admin = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
            conn.execute(text(f'CREATE DATABASE "{name}"'))
    except OperationalError:
        pytest.fail(
            "Postgres de teste indisponível em 127.0.0.1:55432. Rode: ./tasks.ps1 testdb",
            pytrace=False,
        )
    finally:
        admin.dispose()

    engine = create_engine(admin_url.set(database=name))
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "alembic"))
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")
    yield engine
    engine.dispose()


@pytest.fixture
def db(db_engine: Engine) -> Iterator[Session]:
    """Sessão isolada: `commit()` no código vira savepoint; tudo é desfeito no fim do teste."""
    conn = db_engine.connect()
    outer = conn.begin()
    session = Session(bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False)
    try:
        yield session
    finally:
        session.close()
        outer.rollback()
        conn.close()


@pytest.fixture
def users(db: Session) -> dict[str, CurrentUser]:
    """Matheus (admin) e Ruth (member) gravados no banco. Chaves: "matheus", "ruth"."""
    matheus = User(name="Matheus", role="admin", pin_hash="!teste-sem-pin")
    ruth = User(name="Ruth", role="member", pin_hash="!teste-sem-pin")
    db.add_all([matheus, ruth])
    db.flush()
    return {
        "matheus": CurrentUser(id=matheus.id, name="Matheus", role="admin", owner=Owner.MATHEUS),
        "ruth": CurrentUser(id=ruth.id, name="Ruth", role="member", owner=Owner.RUTH),
    }


@pytest.fixture
def app(db: Session) -> FastAPI:
    application = create_app(web_dist=API_DIR / "__sem_pwa__", start_scheduler=False)

    def _db() -> Iterator[Session]:
        yield db

    application.dependency_overrides[get_db] = _db
    return application


@pytest.fixture
def client_as(app: FastAPI) -> Callable[[CurrentUser | None], TestClient]:
    """`client_as(users["ruth"])` → cliente autenticado como Ruth (usuário atual simulado).

    `client_as(None)` → cliente sem simulação: usa o `get_current_user` real (cookie de sessão).
    """

    def _make(user: CurrentUser | None) -> TestClient:
        if user is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = lambda: user
        return TestClient(app)

    return _make
