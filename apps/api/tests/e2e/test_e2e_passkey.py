"""Login em duas etapas (PIN + chave de acesso) com o autenticador virtual do Chromium (CDP)."""

import re
from collections.abc import Iterator

import pytest
from e2e_support import PINS, WRONG_PIN, Env, assert_layout
from playwright.sync_api import BrowserContext, Page, expect
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from finance_api.auth.codes import issue_release_code
from finance_api.auth.service import utcnow
from finance_api.db.models import User

pytestmark = pytest.mark.e2e

GENERIC_ERROR = "Não foi possível entrar. Confira o nome e o PIN."
CONFIRM = "Usar Face ID / digital / Windows Hello"


@pytest.fixture(params=["iphone-11", "desktop"])
def device(request: pytest.FixtureRequest) -> str:
    return str(request.param)


def _clear_passkeys(env: Env) -> None:
    engine = create_engine(env.db_url)
    try:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM access_codes"))
            conn.execute(text("DELETE FROM passkeys"))
            conn.execute(text("DELETE FROM sessions"))
    finally:
        engine.dispose()


@pytest.fixture
def passkey_mode(e2e_env: Env) -> Iterator[None]:
    settings = e2e_env.settings
    saved = (settings.require_passkey, settings.passkey_rp_id, settings.passkey_origin)
    _clear_passkeys(e2e_env)
    settings.require_passkey = True
    settings.passkey_rp_id = "localhost"
    settings.passkey_origin = e2e_env.base_url
    try:
        yield
    finally:
        settings.require_passkey, settings.passkey_rp_id, settings.passkey_origin = saved
        _clear_passkeys(e2e_env)


def virtual_authenticator(page: Page) -> None:
    cdp = page.context.new_cdp_session(page)
    cdp.send("WebAuthn.enable")
    cdp.send(
        "WebAuthn.addVirtualAuthenticator",
        {
            "options": {
                "protocol": "ctap2",
                "transport": "internal",
                "hasResidentKey": True,
                "hasUserVerification": True,
                "isUserVerified": True,
            }
        },
    )


def release_code_for(env: Env, name: str) -> str:
    engine = create_engine(env.db_url)
    try:
        with sessionmaker(bind=engine, expire_on_commit=False)() as db:
            user = db.query(User).filter(User.name == name).one()
            code, _ = issue_release_code(db, user, actor_id=None, now=utcnow())
            db.commit()
            return code
    finally:
        engine.dispose()


def tap_pin(page: Page, pin: str) -> None:
    for digit in pin:
        page.get_by_role("button", name=digit, exact=True).tap()


def fill_credentials(page: Page, name: str, pin: str) -> None:
    page.get_by_label("Seu nome").fill(name)
    tap_pin(page, pin)


def first_access(page: Page, env: Env, name: str = "Ruth") -> None:
    code = release_code_for(env, name)
    page.goto("/")
    expect(page).to_have_url(re.compile(r"/login$"))
    fill_credentials(page, name, PINS[name])
    page.get_by_role("button", name="Tenho um código de liberação").tap()
    page.get_by_label("Código de liberação").fill(code)
    page.get_by_role("button", name="Entrar", exact=True).tap()
    page.get_by_role("button", name=CONFIRM).tap()


def test_primeiro_acesso_com_codigo_cadastra_chave_e_entra(
    page: Page, e2e_env: Env, passkey_mode: None
) -> None:
    virtual_authenticator(page)
    page.goto("/")
    expect(page).to_have_url(re.compile(r"/login$"))
    assert_layout(page, tabbar=False)

    first_access(page, e2e_env, "Matheus")  # admin: recebe os 8 códigos de emergência
    expect(page.get_by_role("heading", name="Guarde seus códigos de emergência")).to_be_visible()
    assert_layout(page, tabbar=False)
    page.get_by_role("button", name="Já guardei").tap()
    expect(page).not_to_have_url(re.compile(r"/login"))
    expect(page.get_by_role("heading", name="Início", exact=True)).to_be_visible()
    assert_layout(page)


def test_segundo_acesso_so_com_chave(
    page: Page, context: BrowserContext, e2e_env: Env, passkey_mode: None
) -> None:
    virtual_authenticator(page)
    first_access(page, e2e_env, "Ruth")  # não admin: sem códigos de emergência
    expect(page.get_by_role("heading", name="Início", exact=True)).to_be_visible()

    assert context.request.post("/api/auth/logout").ok
    page.goto("/")
    expect(page).to_have_url(re.compile(r"/login$"))
    fill_credentials(page, "Ruth", PINS["Ruth"])
    page.get_by_role("button", name="Entrar", exact=True).tap()
    page.get_by_role("button", name=CONFIRM).tap()
    expect(page).not_to_have_url(re.compile(r"/login"))
    expect(page.get_by_role("heading", name="Início", exact=True)).to_be_visible()
    assert_layout(page)


def test_pin_errado_mensagem_generica(
    page: Page, context: BrowserContext, e2e_env: Env, passkey_mode: None
) -> None:
    virtual_authenticator(page)
    first_access(page, e2e_env, "Ruth")
    expect(page.get_by_role("heading", name="Início", exact=True)).to_be_visible()
    assert context.request.post("/api/auth/logout").ok
    page.goto("/")
    fill_credentials(page, "Ruth", WRONG_PIN)
    page.get_by_role("button", name="Entrar", exact=True).tap()
    # O PIN só é conferido no fim (não revela se o nome existe): a falha aparece após confirmar.
    page.get_by_role("button", name=CONFIRM).tap()
    expect(page.get_by_text(GENERIC_ERROR)).to_be_visible()
    expect(page).to_have_url(re.compile(r"/login"))


def test_aviso_abre_destino_apos_login(page: Page, e2e_env: Env, passkey_mode: None) -> None:
    virtual_authenticator(page)
    page.goto("/lancar?meta=4")
    expect(page).to_have_url(re.compile(r"/login\?next="))
    code = release_code_for(e2e_env, "Ruth")
    fill_credentials(page, "Ruth", PINS["Ruth"])
    page.get_by_role("button", name="Tenho um código de liberação").tap()
    page.get_by_label("Código de liberação").fill(code)
    page.get_by_role("button", name="Entrar", exact=True).tap()
    page.get_by_role("button", name=CONFIRM).tap()
    expect(page).to_have_url(re.compile(r"/lancar\?meta=4$"))
