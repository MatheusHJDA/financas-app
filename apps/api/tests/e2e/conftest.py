"""E2E com navegador real (Playwright/Chromium: celulares 414/412 e computador 1280×800).

Sobe o app de verdade (`create_app` + PWA de `apps/web/dist`) numa thread com `uvicorn`, contra um
banco descartável `..._e2e` no Postgres de teste (recriado por sessão, dados COMMITADOS), com uma
IA falsa e determinística. Rode com `./tasks.ps1 e2e` (faz o build do PWA e instala o Chromium).

Segredos: só PINs fictícios de teste, que existem apenas neste banco descartável.
"""

import datetime as dt
import hashlib
import os
import re
import socket
import threading
import time
from collections.abc import Callable, Iterator, Sequence
from pathlib import Path
from typing import Any

import pytest
import uvicorn
from alembic.config import Config
from e2e_support import PINS, Env
from fastapi.testclient import TestClient
from playwright.sync_api import Browser, BrowserContext, Page
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from alembic import command
from finance_api.ai.client import AiCall, get_ai_client
from finance_api.ai.context import AiContext, today_sp
from finance_api.ai.schemas import ExtractedTransaction, ExtractionResult
from finance_api.auth.service import SESSION_COOKIE, ensure_initial_users
from finance_api.core import config as config_module
from finance_api.core.config import Settings, get_settings
from finance_api.db.session import get_db
from finance_api.main import create_app

API_DIR = Path(__file__).resolve().parents[2]
WEB_DIST = API_DIR.parent / "web" / "dist"
ARTIFACTS = Path(__file__).resolve().parent / "artifacts"
DEFAULT_ADMIN_URL = "postgresql+psycopg://financas_test:financas_test@127.0.0.1:55432/postgres"

CHROME_VERSION = "130.0.0.0"
DEVICES: dict[str, dict[str, Any]] = {
    "iphone-11": {
        "viewport": {"width": 414, "height": 896},
        "screen": {"width": 414, "height": 896},
        "device_scale_factor": 2,
        "user_agent": (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
        ),
    },
    "galaxy-a13": {
        "viewport": {"width": 412, "height": 915},
        "screen": {"width": 412, "height": 915},
        "device_scale_factor": 1.75,
        "user_agent": (
            "Mozilla/5.0 (Linux; Android 13; SM-A135M) AppleWebKit/537.36 (KHTML, like Gecko) "
            f"Chrome/{CHROME_VERSION} Mobile Safari/537.36"
        ),
    },
    # Computador (>= 1024px): menu lateral em vez da barra flutuante. Mantém o toque ligado
    # (notebook com tela sensível) para os fluxos continuarem usando `.tap()`.
    "desktop": {
        "viewport": {"width": 1280, "height": 800},
        "screen": {"width": 1280, "height": 800},
        "device_scale_factor": 1,
        "is_mobile": False,
        "user_agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
            f"Chrome/{CHROME_VERSION} Safari/537.36"
        ),
    },
    # Só para a checagem de layout (test_e2e_redesign): celular pequeno, fora dos fluxos comuns.
    "small-360": {
        "viewport": {"width": 360, "height": 740},
        "screen": {"width": 360, "height": 740},
        "device_scale_factor": 2,
        "user_agent": (
            "Mozilla/5.0 (Linux; Android 13; SM-A035M) AppleWebKit/537.36 (KHTML, like Gecko) "
            f"Chrome/{CHROME_VERSION} Mobile Safari/537.36"
        ),
    },
}
# Aparelhos em que TODO fluxo roda (o "small-360" é pedido à parte, por teste).
FLOW_DEVICES = ["iphone-11", "galaxy-a13", "desktop"]


# --- Banco descartável -------------------------------------------------------------------------


def _e2e_db_name() -> str:
    tag = hashlib.sha1(str(API_DIR).lower().encode()).hexdigest()[:10]
    return f"financas_test_{tag}_e2e"


class FakeAi:
    """IA falsa: lê "descrição 45,90 no <conta>" e devolve 1 lançamento. Sem rede."""

    AMOUNT = re.compile(r"(\d+(?:[.,]\d{1,2})?)")

    def extract(self, *, context: AiContext, text: str | None, images: Sequence[bytes]) -> AiCall:
        raw = (text or "").strip()
        match = self.AMOUNT.search(raw)
        if match is None:
            result = ExtractionResult(
                transactions=[],
                document_type="other",
                warnings=["Não encontrei valor no texto."],
            )
        else:
            cents = round(float(match.group(1).replace(".", "").replace(",", ".")) * 100)
            description = raw[: match.start()].strip() or "Lançamento"
            rest = raw[match.end() :].strip()
            account_hint = re.sub(r"^(no|na|em)\s+", "", rest, flags=re.IGNORECASE) or None
            kind = "income" if description.lower().startswith("recebi") else "expense"
            result = ExtractionResult(
                transactions=[
                    ExtractedTransaction(
                        kind=kind,
                        amount_cents=cents,
                        date=context.today,
                        description=description,
                        account_hint=account_hint,
                        to_account_hint=None,
                        category_hint="Mercado" if "mercado" in description.lower() else None,
                        owner_hint=None,
                        is_credit_card=False,
                        confidence=0.95,
                        notes=None,
                    )
                ],
                document_type="free_text",
                warnings=[],
            )
        return AiCall(
            result=result,
            raw={"model": "fake", "output": result.model_dump(mode="json")},
            model="fake-e2e",
            usage_tokens=None,
        )


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _create_database() -> str:
    admin_url = make_url(os.environ.get("TEST_DATABASE_ADMIN_URL", DEFAULT_ADMIN_URL))
    name = _e2e_db_name()
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
    url = admin_url.set(database=name)
    engine = create_engine(url)
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "alembic"))
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")
    engine.dispose()
    return url.render_as_string(hide_password=False)


def _seed(api: TestClient, ids: dict[str, int]) -> None:
    """Dados de apoio pela própria API (como o app grava), um login por dono."""

    def login(name: str, user_id: int) -> None:
        resp = api.post(
            "/api/auth/login",
            json={"user_id": user_id, "pin": PINS[name], "device_label": "e2e-seed"},
        )
        assert resp.status_code == 200, resp.text

    def ok(resp: Any) -> dict:
        assert resp.status_code in (200, 201), resp.text
        return resp.json()

    users = {u["name"]: u["id"] for u in ok(api.get("/api/auth/users"))}
    today = today_sp()  # America/Sao_Paulo, como o app
    opening = (today - dt.timedelta(days=30)).isoformat()

    login("Matheus", users["Matheus"])
    categories = {}
    for name, kind in (("Mercado", "expense"), ("Moradia", "expense"), ("Salário", "income")):
        categories[name] = ok(api.post("/api/categories", json={"name": name, "kind": kind}))["id"]
    accounts = {}
    for key, owner, name, kind, cents in (
        ("matheus", "MATHEUS", "Nubank Matheus", "checking", 150000),
        ("ruth", "RUTH", "Nubank Ruth", "checking", 200000),
        ("reserva", "AMBOS", "Reserva do Casal", "savings", 500000),
    ):
        accounts[key] = ok(
            api.post(
                "/api/accounts",
                json={
                    "owner": owner,
                    "name": name,
                    "type": kind,
                    "initial_balance_cents": cents,
                    "initial_balance_date": opening,
                },
            )
        )["id"]

    def tx(owner: str, account: str, description: str, cents: int, category: str) -> None:
        ok(
            api.post(
                "/api/transactions",
                json={
                    "kind": "expense",
                    "amount_cents": cents,
                    "date": today.isoformat(),
                    "description": description,
                    "account_id": accounts[account],
                    "category_id": categories[category],
                    "owner": owner,
                },
            )
        )

    tx("MATHEUS", "matheus", "Apoio Matheus: Feira", 5000, "Mercado")  # saldo 1.450,00
    tx("AMBOS", "reserva", "Apoio Ambos: Condomínio", 20000, "Moradia")  # saldo 4.800,00
    ok(
        api.post(
            "/api/recurring-bills",
            json={
                "owner": "AMBOS",
                "name": "Internet",
                "amount_cents": 12000,
                "due_day": 28,
                "start_month": today.replace(day=1).isoformat(),
                "account_id": accounts["matheus"],
                "category_id": categories["Moradia"],
            },
        )
    )
    ok(
        api.post(
            "/api/goals",
            json={
                "owner": "AMBOS",
                "type": "accumulate",
                "name": "Reserva de emergência",
                "target_cents": 1000000,
                "linked_account_id": accounts["reserva"],
            },
        )
    )
    api.cookies.clear()

    login("Ruth", users["Ruth"])
    tx("RUTH", "ruth", "Apoio Ruth: Padaria", 3000, "Mercado")  # saldo 1.970,00
    ok(
        api.post(
            "/api/goals",
            json={
                "owner": "RUTH",
                "type": "accumulate",
                "name": "Viagem da Ruth",
                "target_cents": 300000,
            },
        )
    )
    api.cookies.clear()
    ids.update({f"user_{k.lower()}": v for k, v in users.items()})
    ids.update({f"account_{k}": v for k, v in accounts.items()})


@pytest.fixture(scope="session")
def e2e_env(tmp_path_factory: pytest.TempPathFactory) -> Iterator[Env]:
    if not (WEB_DIST / "index.html").is_file():
        pytest.fail(
            "apps/web/dist não existe. Rode: ./tasks.ps1 e2e (faz o build do PWA antes).",
            pytrace=False,
        )
    db_url = _create_database()
    settings = Settings(
        _env_file=None,  # type: ignore[call-arg]
        database_url=db_url,
        initial_pin_matheus=PINS["Matheus"],
        initial_pin_ruth=PINS["Ruth"],
        upload_dir=str(tmp_path_factory.mktemp("uploads")),
        openai_api_key="",
        openai_model="",
    )
    engine = create_engine(db_url)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        created = ensure_initial_users(db, settings)
    assert sorted(created) == ["Matheus", "Ruth"]

    app = create_app(web_dist=WEB_DIST, start_scheduler=False)

    def _db() -> Iterator[Session]:
        db = factory()
        try:
            yield db
        finally:
            db.close()

    original_get_settings = get_settings
    app.dependency_overrides[original_get_settings] = lambda: settings
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_ai_client] = lambda: FakeAi()

    # `get_current_user` chama `get_settings()` direto (fora do Depends): troca no módulo.
    patch = pytest.MonkeyPatch()
    patch.setattr(config_module, "get_settings", lambda: settings)

    ids: dict[str, int] = {}
    # Semeia por https://testserver para o cookie Secure circular no cliente em processo.
    with TestClient(app, base_url="https://testserver") as api:
        _seed(api, ids)

    port = _free_port()
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 20
    while not server.started:
        if not thread.is_alive() or time.monotonic() > deadline:
            pytest.fail("O servidor do e2e não subiu.", pytrace=False)
        time.sleep(0.05)
    try:
        yield Env(base_url=f"http://localhost:{port}", ids=ids, db_url=db_url)
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        patch.undo()
        engine.dispose()


# --- Navegador ---------------------------------------------------------------------------------


@pytest.fixture(params=FLOW_DEVICES, ids=FLOW_DEVICES)
def device(request: pytest.FixtureRequest) -> str:
    return str(request.param)


@pytest.fixture
def context(browser: Browser, device: str, e2e_env: Env) -> Iterator[BrowserContext]:
    spec = {"is_mobile": True, **DEVICES[device]}
    ctx = browser.new_context(
        base_url=e2e_env.base_url,
        has_touch=True,
        locale="pt-BR",
        timezone_id="America/Sao_Paulo",
        service_workers="block",
        **spec,
    )
    ctx.set_default_timeout(10_000)
    yield ctx
    ctx.close()


@pytest.fixture
def page(context: BrowserContext, request: pytest.FixtureRequest) -> Iterator[Page]:
    pg = context.new_page()
    yield pg
    report = getattr(request.node, "rep_call", None)
    if report is not None and report.failed:
        ARTIFACTS.mkdir(parents=True, exist_ok=True)
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", request.node.nodeid.split("::", 1)[-1])
        try:
            pg.screenshot(path=str(ARTIFACTS / f"{safe}.png"), full_page=True)
        except Exception:  # noqa: BLE001 - a captura nunca deve esconder a falha original
            pass
    pg.close()


@pytest.hookimpl(hookwrapper=True, tryfirst=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo) -> Iterator[None]:
    outcome = yield
    report = outcome.get_result()
    setattr(item, f"rep_{report.when}", report)


# --- Ajudantes dos testes ----------------------------------------------------------------------


@pytest.fixture
def login_as(context: BrowserContext, e2e_env: Env) -> Callable[[str], None]:
    """Entra pela API (a tela de login tem o próprio teste); o cookie vai para o navegador."""

    def _login(name: str) -> None:
        resp = context.request.post(
            "/api/auth/login",
            data={
                "user_id": e2e_env.ids[f"user_{name.lower()}"],
                "pin": PINS[name],
                "device_label": "e2e",
            },
        )
        assert resp.ok, resp.text()
        names = [c["name"] for c in context.cookies()]
        assert SESSION_COOKIE in names

    return _login
