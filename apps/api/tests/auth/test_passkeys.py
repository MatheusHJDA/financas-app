"""Entrada em duas etapas (nome + PIN, depois chave de acesso) e sessão curta."""

import base64
import contextlib
import json
from collections.abc import Callable
from datetime import timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from finance_api.auth import codes, passkeys, service
from finance_api.core.config import Settings
from finance_api.db.models import AuthFailure, Passkey, PushSubscription, User, UserSession
from finance_api.db.session import get_session_factory
from finance_api.notifications.channels import SendResult, get_channel

from .conftest import PIN_MATHEUS, PIN_RUTH, Clock
from .soft_authenticator import SoftAuthenticator, b64url

RP_ID = "testserver"
ORIGIN = "https://testserver"
START = "/api/auth/login/start"
FINISH = "/api/auth/login/finish"
GENERIC_401 = {"detail": "Não foi possível entrar. Confira o nome e o PIN."}
PINS = {"Matheus": PIN_MATHEUS, "Ruth": PIN_RUTH}


def _decode(text_: str) -> bytes:
    return base64.urlsafe_b64decode(text_ + "=" * (-len(text_) % 4))


def _failures(db: Session) -> int:
    db.expire_all()
    return db.scalar(select(func.count()).select_from(AuthFailure)) or 0


class Flow:
    """Atalhos para as duas etapas, com um cliente (aparelho) por chamada."""

    def __init__(self, db: Session, clock: Clock, new_client: Callable[..., TestClient]) -> None:
        self.db = db
        self.clock = clock
        self.new_client = new_client

    def code(self, user: User) -> str:
        code, _ = codes.issue_release_code(self.db, user, actor_id=None, now=self.clock.now)
        return code

    def start(
        self, client: TestClient, name: str, pin: str, code: str | None = None
    ) -> dict[str, Any]:
        body = {"name": name, "pin": pin, "device_label": "iPhone", "release_code": code}
        response = client.post(START, json=body)
        assert response.status_code == 200, response.text
        return response.json()

    def finish(self, client: TestClient, attempt_id: str, credential: dict[str, Any]) -> Any:
        return client.post(FINISH, json={"attempt_id": attempt_id, "credential": credential})

    def register(
        self, user: User, device: SoftAuthenticator, *, pin: str | None = None
    ) -> tuple[TestClient, Any]:
        client = self.new_client()
        started = self.start(client, user.name, pin or PINS[user.name], self.code(user))
        assert started["mode"] == "register"
        response = self.finish(client, started["attempt_id"], device.register(started["options"]))
        return client, response

    def login(
        self, user: User, device: SoftAuthenticator, *, pin: str | None = None
    ) -> tuple[TestClient, Any]:
        client = self.new_client()
        started = self.start(client, user.name, pin or PINS[user.name])
        response = self.finish(
            client, started["attempt_id"], device.authenticate(started["options"])
        )
        return client, response


@pytest.fixture
def flow(
    db: Session,
    clock: Clock,
    auth_users: dict[str, User],
    new_client: Callable[..., TestClient],
    passkey_settings: Settings,
) -> Flow:
    return Flow(db, clock, new_client)


def _device() -> SoftAuthenticator:
    return SoftAuthenticator(RP_ID, ORIGIN)


# --- autenticador de teste -------------------------------------------------------------------


def test_soft_authenticator_roundtrip() -> None:
    device = _device()
    reg = generate_registration_options(
        rp_id=RP_ID,
        rp_name="Finanças",
        user_name="Matheus",
        user_id=b"u" * 16,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
    )
    created = verify_registration_response(
        credential=device.register(json.loads(options_to_json(reg))),
        expected_challenge=reg.challenge,
        expected_rp_id=RP_ID,
        expected_origin=ORIGIN,
        require_user_verification=True,
    )
    assert created.credential_id == device.credential_id
    sign_count = created.sign_count
    for _ in range(2):
        auth = generate_authentication_options(
            rp_id=RP_ID, user_verification=UserVerificationRequirement.REQUIRED
        )
        assertion = device.authenticate(json.loads(options_to_json(auth)))
        assert assertion["response"]["userHandle"] == b64url(b"u" * 16)
        verified = verify_authentication_response(
            credential=assertion,
            expected_challenge=auth.challenge,
            expected_rp_id=RP_ID,
            expected_origin=ORIGIN,
            credential_public_key=created.credential_public_key,
            credential_current_sign_count=sign_count,
            require_user_verification=True,
        )
        assert verified.new_sign_count == sign_count + 1
        sign_count = verified.new_sign_count


# --- cadastro e entrada ----------------------------------------------------------------------


def test_attempt_ttl() -> None:
    assert passkeys.ATTEMPT_TTL == timedelta(minutes=2)


def test_cadastro_com_codigo_entra_e_da_codigos_de_emergencia_ao_admin(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    matheus, ruth = auth_users["matheus"], auth_users["ruth"]
    client, response = flow.register(matheus, _device())
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["me"]["name"] == "Matheus"
    assert len(body["recovery_codes"]) == 8
    cookie = response.headers["set-cookie"].lower()
    assert "max-age=43200" in cookie
    assert "httponly" in cookie and "secure" in cookie and "samesite=strict" in cookie
    assert client.get("/api/auth/me").json()["name"] == "Matheus"

    _, second = flow.register(matheus, _device())
    assert second.status_code == 200
    assert second.json()["recovery_codes"] is None

    _, ruth_response = flow.register(ruth, _device())
    assert ruth_response.status_code == 200
    assert ruth_response.json()["recovery_codes"] is None

    db.expire_all()
    keys = db.scalars(select(Passkey).order_by(Passkey.id)).all()
    assert [(k.user_id, k.device_label) for k in keys] == [
        (matheus.id, "iPhone"),
        (matheus.id, "iPhone"),
        (ruth.id, "iPhone"),
    ]
    sessions = db.scalars(select(UserSession)).all()
    assert all(s.two_factor for s in sessions)


def test_login_com_chave_entra(db: Session, flow: Flow, auth_users: dict[str, User]) -> None:
    ruth = auth_users["ruth"]
    device = _device()
    flow.register(ruth, device)
    client, response = flow.login(ruth, device)
    assert response.status_code == 200, response.text
    assert response.json() == {"me": response.json()["me"], "recovery_codes": None}
    assert client.get("/api/auth/me").json()["name"] == "Ruth"
    db.expire_all()
    key = db.scalars(select(Passkey)).one()
    assert key.sign_count == device.sign_count
    assert key.last_used_at == flow.clock.now


def test_nome_com_espacos_e_maiusculas_entra(flow: Flow, auth_users: dict[str, User]) -> None:
    device = _device()
    flow.register(auth_users["ruth"], device)
    client = flow.new_client()
    started = flow.start(client, "  RUTH ", PIN_RUTH)
    response = flow.finish(client, started["attempt_id"], device.authenticate(started["options"]))
    assert response.status_code == 200


def test_start_nao_revela_veredito(db: Session, flow: Flow, auth_users: dict[str, User]) -> None:
    matheus, ruth = auth_users["matheus"], auth_users["ruth"]
    ruth.locked_at = flow.clock.now
    db.flush()
    client = flow.new_client()
    cases = [
        ("Matheus", PIN_MATHEUS),
        ("Matheus", "000000"),
        ("Fulano", "123456"),
        ("Ruth", PIN_RUTH),
    ]
    logins = [flow.start(client, name, pin) for name, pin in cases]
    for started in logins:
        assert set(started) == {"attempt_id", "mode", "options"}
        assert started["mode"] == "login"
        assert started["options"]["allowCredentials"] == []
        assert started["options"]["userVerification"] == "required"
        assert set(started["options"]) == set(logins[0]["options"])
    assert len({s["attempt_id"] for s in logins}) == 4

    registers = [flow.start(client, name, pin, "AAAAA-BBBBB") for name, pin in cases]
    for started in registers:
        assert set(started) == {"attempt_id", "mode", "options"}
        assert started["mode"] == "register"
        options = started["options"]
        assert set(options) == set(registers[0]["options"])
        assert len(_decode(options["user"]["id"])) == 16
        assert options["excludeCredentials"] == []
        assert options["authenticatorSelection"]["residentKey"] == "required"
        assert options["authenticatorSelection"]["userVerification"] == "required"
    assert registers[2]["options"]["user"]["name"] == "Fulano"
    # O mesmo user.id do Matheus com PIN certo ou errado: o PIN não muda nada visível.
    assert registers[0]["options"]["user"]["id"] == registers[1]["options"]["user"]["id"]
    db.expire_all()
    assert _decode(registers[0]["options"]["user"]["id"]) == matheus.webauthn_user_id
    # Só a etapa final dá veredito (e conta falhas): o início não conta nada.
    assert _failures(db) == 0


def test_inicio_com_pin_errado_nao_bloqueia_a_origem(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    """Se o início contasse falhas, o 429 revelaria se o PIN estava certo."""
    client = flow.new_client()
    for _ in range(8):
        flow.start(client, "Ruth", "000000")
    assert _failures(db) == 0


def _starts_until_blocked(client: TestClient, pin: str) -> tuple[int, Any]:
    body = {"name": "Ruth", "pin": pin, "device_label": "iPhone"}
    for count in range(1, 100):
        response = client.post(START, json=body)
        if response.status_code != 200:
            return count, response
    raise AssertionError("o início nunca foi limitado")


def test_inicio_limitado_por_origem_sem_revelar_o_pin(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    """Muitos inícios da mesma origem dão 429 no mesmo ponto, com PIN certo ou errado."""
    from finance_api.auth import limits

    assert limits.SOURCE_MAX_STARTS == 20
    wrong_at, wrong = _starts_until_blocked(flow.new_client("10.0.0.7"), "000000")
    right_at, right = _starts_until_blocked(flow.new_client("10.0.0.8"), PIN_RUTH)
    assert wrong_at == right_at == limits.SOURCE_MAX_STARTS + 1
    for response in (wrong, right):
        assert response.status_code == 429
        assert int(response.headers["retry-after"]) == 15 * 60
    assert _failures(db) == 0
    # Outra origem segue livre; a origem limitada volta quando o início mais antigo sai da janela.
    flow.start(flow.new_client("10.0.0.9"), "Ruth", PIN_RUTH)
    flow.clock.advance(minutes=15, seconds=1)
    flow.start(flow.new_client("10.0.0.7"), "Ruth", PIN_RUTH)


def test_origem_bloqueada_recebe_429(db: Session, flow: Flow, auth_users: dict[str, User]) -> None:
    client = flow.new_client()
    for _ in range(5):
        started = flow.start(client, "Ruth", PIN_RUTH)
        response = flow.finish(
            client, started["attempt_id"], _device().authenticate(started["options"])
        )
        assert response.status_code == 401
    blocked = client.post(START, json={"name": "Ruth", "pin": PIN_RUTH, "device_label": "iPhone"})
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) > 0


def test_pin_errado_com_chave_certa_falha(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    matheus = auth_users["matheus"]
    device = _device()
    flow.register(matheus, device)
    assert _failures(db) == 0
    _, response = flow.login(matheus, device, pin="000000")
    assert response.status_code == 401
    assert response.json() == GENERIC_401
    assert "set-cookie" not in response.headers
    assert _failures(db) == 1


def test_chave_de_outra_pessoa_falha(db: Session, flow: Flow, auth_users: dict[str, User]) -> None:
    matheus, ruth = auth_users["matheus"], auth_users["ruth"]
    flow.register(matheus, _device())
    ruth_device = _device()
    flow.register(ruth, ruth_device)
    _, response = flow.login(matheus, ruth_device)
    assert response.status_code == 401
    assert response.json() == GENERIC_401
    assert _failures(db) == 1
    db.expire_all()
    # Chave de outra pessoa não prova o segundo fator: conta só para a origem.
    assert db.get(User, matheus.id).failed_attempts == 0


def _garbage_round(flow: Flow, client: TestClient, name: str, pin: str) -> None:
    for _ in range(5):
        started = flow.start(client, name, pin)
        response = flow.finish(
            client, started["attempt_id"], _device().authenticate(started["options"])
        )
        assert response.status_code == 401
        assert response.json() == GENERIC_401


def test_estranho_sem_aparelho_nao_trava_a_conta(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    """Só o nome não basta para travar a conta de alguém: sem a chave, a falha é da origem."""
    ruth = auth_users["ruth"]
    device = _device()
    flow.register(ruth, device)
    attacker = flow.new_client("10.9.9.9")
    for round_ in range(4):  # 20 falhas em 45 min, da mesma origem
        _garbage_round(flow, attacker, "Ruth", "000000" if round_ % 2 else PIN_RUTH)
        blocked = attacker.post(
            START, json={"name": "Ruth", "pin": PIN_RUTH, "device_label": "iPhone"}
        )
        assert blocked.status_code == 429
        flow.clock.advance(minutes=15, seconds=1)
    assert _failures(db) == 20
    db.expire_all()
    fresh = db.get(User, ruth.id)
    assert fresh.locked_at is None
    assert fresh.failed_attempts == 0
    assert flow.login(ruth, device)[1].status_code == 200


def test_cadastro_com_codigo_falso_nao_conta_para_a_conta(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    ruth = auth_users["ruth"]
    client = flow.new_client()
    for pin in ("000000", PIN_RUTH):
        started = flow.start(client, "Ruth", pin, "AAAAA-BBBBB")
        response = flow.finish(
            client, started["attempt_id"], _device().register(started["options"])
        )
        assert response.status_code == 401
        assert response.json() == GENERIC_401
    assert _failures(db) == 2
    db.expire_all()
    assert db.get(User, ruth.id).failed_attempts == 0


def test_cadastro_com_codigo_certo_e_pin_errado_conta_para_a_conta(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    ruth = auth_users["ruth"]
    client = flow.new_client()
    started = flow.start(client, "Ruth", "000000", flow.code(ruth))
    response = flow.finish(client, started["attempt_id"], _device().register(started["options"]))
    assert response.status_code == 401
    assert response.json() == GENERIC_401
    db.expire_all()
    assert db.get(User, ruth.id).failed_attempts == 1


def test_aparelho_certo_com_pin_errado_20_vezes_trava_a_conta(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    ruth = auth_users["ruth"]
    device = _device()
    flow.register(ruth, device)
    for i in range(20):  # origens diferentes: o limite da origem não para antes
        client = flow.new_client(f"10.0.1.{i}")
        started = flow.start(client, "Ruth", "000000")
        response = flow.finish(
            client, started["attempt_id"], device.authenticate(started["options"])
        )
        assert response.status_code == 401
        assert response.json() == GENERIC_401
    db.expire_all()
    assert db.get(User, ruth.id).locked_at is not None
    client = flow.new_client("10.0.2.1")
    started = flow.start(client, "Ruth", PIN_RUTH)
    response = flow.finish(client, started["attempt_id"], device.authenticate(started["options"]))
    assert response.status_code == 401
    assert response.json() == GENERIC_401


def test_conta_travada_nao_entra_mesmo_com_tudo_certo(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    ruth = auth_users["ruth"]
    device = _device()
    flow.register(ruth, device)
    ruth.locked_at = flow.clock.now
    db.flush()
    _, response = flow.login(ruth, device)
    assert response.status_code == 401
    assert response.json() == GENERIC_401


def test_tentativa_reusada_ou_vencida_falha(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    ruth = auth_users["ruth"]
    device = _device()
    flow.register(ruth, device)

    client = flow.new_client()
    started = flow.start(client, "Ruth", PIN_RUTH)
    assert (
        flow.finish(
            client, started["attempt_id"], device.authenticate(started["options"])
        ).status_code
        == 200
    )
    reused = flow.finish(client, started["attempt_id"], device.authenticate(started["options"]))
    assert reused.status_code == 401
    assert reused.json() == GENERIC_401

    started = flow.start(client, "Ruth", PIN_RUTH)
    flow.clock.advance(minutes=2, seconds=1)
    late = flow.finish(client, started["attempt_id"], device.authenticate(started["options"]))
    assert late.status_code == 401
    assert late.json() == GENERIC_401

    unknown = flow.finish(client, "nao-existe", device.authenticate(started["options"]))
    assert unknown.status_code == 401
    assert _failures(db) == 3


def test_tentativa_falha_tambem_e_usada(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    """Uma falha queima a tentativa: não dá para tentar de novo com outra chave."""
    ruth = auth_users["ruth"]
    device = _device()
    flow.register(ruth, device)
    client = flow.new_client()
    started = flow.start(client, "Ruth", PIN_RUTH)
    bad = flow.finish(client, started["attempt_id"], _device().authenticate(started["options"]))
    assert bad.status_code == 401
    good = flow.finish(client, started["attempt_id"], device.authenticate(started["options"]))
    assert good.status_code == 401


def test_codigo_usado_nao_cadastra_de_novo(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    ruth = auth_users["ruth"]
    code = flow.code(ruth)
    client = flow.new_client()
    started = flow.start(client, "Ruth", PIN_RUTH, code)
    assert (
        flow.finish(
            client, started["attempt_id"], _device().register(started["options"])
        ).status_code
        == 200
    )
    again = flow.start(client, "Ruth", PIN_RUTH, code.lower().replace("-", ""))
    response = flow.finish(client, again["attempt_id"], _device().register(again["options"]))
    assert response.status_code == 401
    assert response.json() == GENERIC_401
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(Passkey)) == 1


def test_codigo_de_outra_pessoa_nao_cadastra(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    client = flow.new_client()
    started = flow.start(client, "Ruth", PIN_RUTH, flow.code(auth_users["matheus"]))
    response = flow.finish(client, started["attempt_id"], _device().register(started["options"]))
    assert response.status_code == 401


def test_cadastro_com_pin_errado_nao_gasta_o_codigo(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    ruth = auth_users["ruth"]
    code = flow.code(ruth)
    client = flow.new_client()
    started = flow.start(client, "Ruth", "000000", code)
    response = flow.finish(client, started["attempt_id"], _device().register(started["options"]))
    assert response.status_code == 401
    started = flow.start(client, "Ruth", PIN_RUTH, code)
    response = flow.finish(client, started["attempt_id"], _device().register(started["options"]))
    assert response.status_code == 200


def test_sem_chave_sem_codigo_nao_entra(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    _, response = flow.login(auth_users["ruth"], _device())
    assert response.status_code == 401
    assert response.json() == GENERIC_401


def test_credencial_malformada_falha_generico(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    client = flow.new_client()
    started = flow.start(client, "Ruth", PIN_RUTH)
    response = flow.finish(client, started["attempt_id"], {"id": "x", "response": "lixo"})
    assert response.status_code == 401
    assert response.json() == GENERIC_401
    assert _failures(db) == 1


class _FakeChannel:
    name = "fake"

    def __init__(self) -> None:
        self.sent: list[tuple[int, dict[str, str]]] = []

    def send(self, subscription: PushSubscription, payload: dict[str, str]) -> SendResult:
        self.sent.append((subscription.user_id, payload))
        return SendResult(ok=True)


class _BrokenChannel:
    name = "quebrado"

    def send(self, subscription: PushSubscription, payload: dict[str, str]) -> SendResult:
        raise RuntimeError("sem rede")


def _subscribe(db: Session, user: User) -> None:
    db.add(
        PushSubscription(
            user_id=user.id,
            endpoint=f"https://push.test/{user.id}",
            keys_json={"p256dh": "x", "auth": "y"},
            device_label="Celular antigo",
        )
    )
    db.flush()


def _own_sessions(app: FastAPI, db: Session) -> list[str]:
    """Troca a fábrica de sessões do aviso por uma que usa a sessão do teste e conta os usos."""
    opened: list[str] = []

    def _factory() -> contextlib.AbstractContextManager[Session]:
        opened.append("aberta")
        return contextlib.nullcontext(db)

    app.dependency_overrides[get_session_factory] = lambda: _factory
    return opened


def test_aviso_de_aparelho_novo(
    app: FastAPI, db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    """O aviso roda depois da resposta (tarefa de fundo), com sessão de banco própria."""
    channel = _FakeChannel()
    app.dependency_overrides[get_channel] = lambda: channel
    opened = _own_sessions(app, db)
    matheus = auth_users["matheus"]
    flow.register(matheus, _device())
    _subscribe(db, matheus)
    _, response = flow.register(matheus, _device())
    assert response.status_code == 200
    assert channel.sent == [
        (
            matheus.id,
            {
                "title": "Aparelho novo liberado",
                "body": "Um aparelho novo foi liberado na sua conta: iPhone",
                "url": "/preferencias",
            },
        )
    ]
    assert opened == ["aberta", "aberta"]  # uma sessão própria por cadastro


def test_falha_no_aviso_nao_derruba_o_cadastro(
    app: FastAPI,
    db: Session,
    flow: Flow,
    auth_users: dict[str, User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app.dependency_overrides[get_channel] = lambda: _BrokenChannel()

    def _explode(*args: object, **kwargs: object) -> int:
        raise RuntimeError("banco fora")

    monkeypatch.setattr(passkeys, "deliver", _explode)
    _own_sessions(app, db)
    ruth = auth_users["ruth"]
    _subscribe(db, ruth)
    client, response = flow.register(ruth, _device())
    assert response.status_code == 200
    assert client.get("/api/auth/me").status_code == 200


# --- sessão ----------------------------------------------------------------------------------


def _session_client(db: Session, flow: Flow, user: User, *, two_factor: bool) -> TestClient:
    token = f"token-de-teste-{two_factor}"
    db.add(
        UserSession(
            token_hash=service.hash_token(token),
            user_id=user.id,
            device_label="PC",
            expires_at=flow.clock.now + timedelta(days=1),
            two_factor=two_factor,
            max_expires_at=flow.clock.now + timedelta(hours=12),
        )
    )
    db.flush()
    client = flow.new_client()
    client.headers["Cookie"] = f"{service.SESSION_COOKIE}={token}"
    return client


def test_sessao_pin_so_nao_vale_com_chave_ligada(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    ruth = auth_users["ruth"]
    assert _session_client(db, flow, ruth, two_factor=False).get("/api/auth/me").status_code == 401
    assert _session_client(db, flow, ruth, two_factor=True).get("/api/auth/me").status_code == 200


def test_sessao_30min_parada_e_12h_maximo(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    ruth = auth_users["ruth"]
    device = _device()
    client, _ = flow.register(ruth, device)
    flow.clock.advance(minutes=29)
    response = client.get("/api/auth/me")
    assert response.status_code == 200
    assert "max-age=43200" in response.headers["set-cookie"].lower()
    flow.clock.advance(minutes=29)
    assert client.get("/api/auth/me").status_code == 200  # renovou aos 29 min
    flow.clock.advance(minutes=31)
    assert client.get("/api/auth/me").status_code == 401

    client, response = flow.login(ruth, device)
    assert response.status_code == 200
    for _ in range(35):  # 35 × 20 min = 11 h 40 min
        flow.clock.advance(minutes=20)
        assert client.get("/api/auth/me").status_code == 200
    flow.clock.advance(minutes=20)  # 12 h
    assert client.get("/api/auth/me").status_code == 401


def test_open_session_sem_chave_exigida_dura_session_days(
    db: Session, clock: Clock, auth_users: dict[str, User]
) -> None:
    from finance_api.core.config import get_settings

    settings = get_settings()
    assert not settings.require_passkey
    _, session = service.open_session(
        db, auth_users["ruth"], device_label="PC", two_factor=False, settings=settings
    )
    assert session.expires_at == clock.now + timedelta(days=settings.session_days)
    assert session.max_expires_at is None
    assert session.two_factor is False


def test_login_so_pin_desligado_quando_chave_exigida(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    client = flow.new_client()
    response = client.post(
        "/api/auth/login", json={"name": "Ruth", "pin": PIN_RUTH, "device_label": "PC"}
    )
    assert response.status_code == 401
    assert response.json() == GENERIC_401
    assert "set-cookie" not in response.headers


def test_config_le_require_passkey(flow: Flow) -> None:
    assert flow.new_client().get("/api/auth/config").json() == {"passkey_required": True}


def test_auditoria_sem_segredos(db: Session, flow: Flow, auth_users: dict[str, User]) -> None:
    matheus = auth_users["matheus"]
    code = flow.code(matheus)
    client = flow.new_client()
    started = flow.start(client, "Matheus", PIN_MATHEUS, code)
    response = flow.finish(client, started["attempt_id"], _device().register(started["options"]))
    assert response.status_code == 200
    failed = flow.start(client, "Matheus", "000000")
    flow.finish(client, failed["attempt_id"], _device().authenticate(failed["options"]))

    rows = db.execute(
        text("SELECT entity, action, after_json::text FROM audit_log ORDER BY id")
    ).all()
    entries = [(entity, action) for entity, action, _ in rows]
    assert ("passkeys", "create") in entries
    assert entries.count(("sessions", "create")) == 2
    afters = [json.loads(after) for entity, _, after in rows if entity in ("passkeys", "sessions")]
    assert {"user_id": matheus.id, "device_label": "iPhone"} in afters
    assert {"user_id": matheus.id, "two_factor": True} in afters
    assert {"user_id": matheus.id, "ok": False, "source": "testclient"} in afters

    blob = "\n".join(after or "" for _, _, after in rows)
    secrets_ = [
        PIN_MATHEUS,
        code,
        code.replace("-", ""),
        codes.hash_code(code),
        started["attempt_id"],
        failed["attempt_id"],
        started["options"]["challenge"],
        failed["options"]["challenge"],
        client.cookies.get(service.SESSION_COOKIE) or "sem-cookie",
        *response.json()["recovery_codes"],
    ]
    for secret in secrets_:
        assert secret not in blob


# --- gerenciar chaves e desbloquear conta ----------------------------------------------------


def test_lista_so_as_proprias_chaves(flow: Flow, auth_users: dict[str, User]) -> None:
    matheus, ruth = auth_users["matheus"], auth_users["ruth"]
    m_client, _ = flow.register(matheus, _device())
    r_client, _ = flow.register(ruth, _device())
    mine = m_client.get("/api/auth/passkeys")
    assert mine.status_code == 200
    assert len(mine.json()) == 1
    assert mine.json()[0].keys() == {"id", "device_label", "created_at", "last_used_at"}
    assert mine.json()[0]["id"] != r_client.get("/api/auth/passkeys").json()[0]["id"]
    assert flow.new_client().get("/api/auth/passkeys").status_code == 401


def test_membro_nao_remove_chave_de_outro_e_admin_remove(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    matheus, ruth = auth_users["matheus"], auth_users["ruth"]
    m_client, _ = flow.register(matheus, _device())
    r_client, _ = flow.register(ruth, _device())
    m_id = m_client.get("/api/auth/passkeys").json()[0]["id"]
    r_id = r_client.get("/api/auth/passkeys").json()[0]["id"]

    assert r_client.delete(f"/api/auth/passkeys/{m_id}").status_code == 403
    assert r_client.delete("/api/auth/passkeys/999999").status_code == 404
    assert m_client.delete(f"/api/auth/passkeys/{r_id}").status_code == 204
    db.expire_all()
    assert db.get(Passkey, r_id) is None
    assert db.get(Passkey, m_id) is not None
    from finance_api.db.models import AuditLog

    rows = db.scalars(
        select(AuditLog).where(AuditLog.entity == "passkeys", AuditLog.action == "delete")
    ).all()
    assert [(r.action, r.entity_id, r.user_id) for r in rows] == [("delete", str(r_id), matheus.id)]
    assert "public_key" not in json.dumps([r.before_json for r in rows])


def test_removida_a_ultima_chave_codigo_de_emergencia_cadastra_outra(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    matheus = auth_users["matheus"]
    client, response = flow.register(matheus, _device())
    recovery = response.json()["recovery_codes"][0]
    key_id = client.get("/api/auth/passkeys").json()[0]["id"]
    assert client.delete(f"/api/auth/passkeys/{key_id}").status_code == 204
    assert client.get("/api/auth/passkeys").json() == []

    fresh = flow.new_client()
    started = flow.start(fresh, "Matheus", PIN_MATHEUS, recovery)
    assert started["mode"] == "register"
    done = flow.finish(fresh, started["attempt_id"], _device().register(started["options"]))
    assert done.status_code == 200, done.text
    assert len(fresh.get("/api/auth/passkeys").json()) == 1


def test_admin_lista_chaves_de_outro_usuario(flow: Flow, auth_users: dict[str, User]) -> None:
    matheus, ruth = auth_users["matheus"], auth_users["ruth"]
    m_client, _ = flow.register(matheus, _device())
    r_client, _ = flow.register(ruth, _device())
    flow.register(ruth, _device())
    listed = m_client.get(f"/api/admin/users/{ruth.id}/passkeys")
    assert listed.status_code == 200
    assert len(listed.json()) == 2
    assert m_client.get("/api/admin/users/99999/passkeys").status_code == 404
    assert r_client.get(f"/api/admin/users/{matheus.id}/passkeys").status_code == 403
    users = {u["name"]: u for u in m_client.get("/api/admin/users").json()}
    assert users["Ruth"]["passkey_count"] == 2
    assert users["Matheus"]["passkey_count"] == 1
    assert users["Ruth"]["locked_at"] is None


def test_unlock_devolve_o_acesso_e_audita(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    from finance_api.db.models import AuditLog

    matheus, ruth = auth_users["matheus"], auth_users["ruth"]
    m_client, _ = flow.register(matheus, _device())
    r_device = _device()
    flow.register(ruth, r_device)
    ruth.locked_at = flow.clock.now
    ruth.failed_attempts = 20
    db.flush()
    db.commit()
    _, blocked = flow.login(ruth, r_device)
    assert blocked.status_code == 401

    assert flow.new_client().post(f"/api/admin/users/{ruth.id}/unlock").status_code == 401
    assert m_client.post("/api/admin/users/99999/unlock").status_code == 404
    assert m_client.post(f"/api/admin/users/{ruth.id}/unlock").status_code == 204
    db.expire_all()
    assert db.get(User, ruth.id).locked_at is None
    assert db.get(User, ruth.id).failed_attempts == 0
    _, ok = flow.login(ruth, r_device)
    assert ok.status_code == 200, ok.text
    row = db.scalars(
        select(AuditLog).where(AuditLog.entity == "users", AuditLog.entity_id == str(ruth.id))
    ).all()[-1]
    assert row.before_json == {"locked": True}
    assert row.after_json == {"locked": False, "unlocked": True}


def test_membro_nao_destrava(flow: Flow, auth_users: dict[str, User]) -> None:
    matheus, ruth = auth_users["matheus"], auth_users["ruth"]
    r_client, _ = flow.register(ruth, _device())
    assert r_client.post(f"/api/admin/users/{matheus.id}/unlock").status_code == 403


def test_remover_a_propria_chave_desconecta_os_outros_aparelhos(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    from finance_api.db.models import AuditLog

    ruth = auth_users["ruth"]
    phone, pc = _device(), _device()
    phone_client, _ = flow.register(ruth, phone)
    pc_client, _ = flow.register(ruth, pc)
    keys = phone_client.get("/api/auth/passkeys").json()
    pc_key = keys[-1]["id"]
    assert phone_client.delete(f"/api/auth/passkeys/{pc_key}").status_code == 204
    assert pc_client.get("/api/auth/me").status_code == 401
    assert phone_client.get("/api/auth/me").status_code == 200
    row = db.scalars(
        select(AuditLog).where(AuditLog.entity == "passkeys", AuditLog.action == "delete")
    ).one()
    assert row.after_json == {"sessions_revoked": 1}


def test_admin_remove_chave_de_outro_e_desconecta_todos_os_aparelhos_dele(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    matheus, ruth = auth_users["matheus"], auth_users["ruth"]
    m_client, _ = flow.register(matheus, _device())
    r_phone, _ = flow.register(ruth, _device())
    r_pc, _ = flow.register(ruth, _device())
    r_key = r_phone.get("/api/auth/passkeys").json()[0]["id"]
    assert m_client.delete(f"/api/auth/passkeys/{r_key}").status_code == 204
    assert r_phone.get("/api/auth/me").status_code == 401
    assert r_pc.get("/api/auth/me").status_code == 401
    assert m_client.get("/api/auth/me").status_code == 200


def test_sessoes_so_pin_nao_aparecem_com_chave_exigida(
    db: Session, flow: Flow, auth_users: dict[str, User]
) -> None:
    ruth = auth_users["ruth"]
    _session_client(db, flow, ruth, two_factor=False)
    client = _session_client(db, flow, ruth, two_factor=True)
    listed = client.get("/api/auth/sessions").json()
    assert len(listed) == 1
    assert listed[0]["current"] is True
