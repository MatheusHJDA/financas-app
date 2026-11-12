import hashlib
import json
import logging
from collections.abc import Callable
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from finance_api.auth import OWNER_BY_USER_NAME, service
from finance_api.core.config import Settings
from finance_api.core.permissions import Owner
from finance_api.db.models import AuditLog, User, UserSession

from .conftest import PIN_MATHEUS, PIN_RUTH, Clock

LOGIN = "/api/auth/login"


def _login_body(user: User, pin: str, device: str = "Celular") -> dict[str, object]:
    return {"user_id": user.id, "pin": pin, "device_label": device}


def _audit(db: Session, entity: str) -> list[AuditLog]:
    db.expire_all()
    return list(db.scalars(select(AuditLog).where(AuditLog.entity == entity).order_by(AuditLog.id)))


# --- login ---------------------------------------------------------------------------------


def test_owner_mapping_constant() -> None:
    assert OWNER_BY_USER_NAME == {"Matheus": Owner.MATHEUS, "Ruth": Owner.RUTH}


def test_list_login_users_is_public(
    auth_users: dict[str, User], new_client: Callable[[], TestClient]
) -> None:
    response = new_client().get("/api/auth/users")
    assert response.status_code == 200
    assert response.json() == [
        {"id": auth_users["matheus"].id, "name": "Matheus"},
        {"id": auth_users["ruth"].id, "name": "Ruth"},
    ]


def test_login_ok_returns_me_and_cookie(
    auth_users: dict[str, User], new_client: Callable[[], TestClient]
) -> None:
    client = new_client()
    response = client.post(LOGIN, json=_login_body(auth_users["ruth"], PIN_RUTH, "iPhone da Ruth"))
    assert response.status_code == 200
    assert response.json() == {
        "id": auth_users["ruth"].id,
        "name": "Ruth",
        "role": "member",
        "owner": "RUTH",
    }
    assert "session" in client.cookies


def test_cookie_flags(auth_users: dict[str, User], new_client: Callable[[], TestClient]) -> None:
    response = new_client().post(LOGIN, json=_login_body(auth_users["matheus"], PIN_MATHEUS))
    header = response.headers["set-cookie"]
    parts = [p.strip().lower() for p in header.split(";")]
    assert parts[0].startswith("session=")
    assert "httponly" in parts
    assert "secure" in parts
    assert "samesite=strict" in parts
    assert "path=/" in parts
    assert f"max-age={30 * 86400}" in parts


def test_login_wrong_pin_unknown_user_and_bad_format_are_indistinguishable(
    auth_users: dict[str, User], new_client: Callable[[], TestClient]
) -> None:
    client = new_client()
    wrong = client.post(LOGIN, json=_login_body(auth_users["ruth"], "000000"))
    unknown = client.post(LOGIN, json={"user_id": 999999, "pin": PIN_RUTH, "device_label": "x"})
    malformed = client.post(LOGIN, json=_login_body(auth_users["ruth"], "12ab"))
    assert wrong.status_code == unknown.status_code == malformed.status_code == 401
    assert wrong.json() == unknown.json() == malformed.json()
    assert "session" not in client.cookies


def test_login_requires_device_label(
    auth_users: dict[str, User], new_client: Callable[[], TestClient]
) -> None:
    response = new_client().post(LOGIN, json=_login_body(auth_users["ruth"], PIN_RUTH, "   "))
    assert response.status_code == 422


def test_token_never_stored_in_plain_text(
    db: Session, auth_users: dict[str, User], new_client: Callable[[], TestClient]
) -> None:
    client = new_client()
    client.post(LOGIN, json=_login_body(auth_users["ruth"], PIN_RUTH))
    token = client.cookies["session"]
    db.expire_all()
    sessions = list(db.scalars(select(UserSession)))
    assert len(sessions) == 1
    row = sessions[0]
    assert row.token_hash == hashlib.sha256(token.encode()).hexdigest()
    assert len(row.token_hash) == 64
    assert token not in (row.token_hash, row.device_label)
    assert len(token) >= 43  # token_urlsafe(32)


def test_pin_is_stored_as_argon2(db: Session, auth_users: dict[str, User]) -> None:
    for user in auth_users.values():
        assert user.pin_hash.startswith("$argon2")
        assert PIN_MATHEUS not in user.pin_hash


# --- bloqueio ------------------------------------------------------------------------------


def test_lock_after_five_wrong_attempts_and_release_after_15_minutes(
    db: Session,
    clock: Clock,
    auth_users: dict[str, User],
    new_client: Callable[[], TestClient],
) -> None:
    client = new_client()
    ruth = auth_users["ruth"]
    for _ in range(4):
        assert client.post(LOGIN, json=_login_body(ruth, "000000")).status_code == 401
    locked = client.post(LOGIN, json=_login_body(ruth, "000000"))
    assert locked.status_code == 423
    assert int(locked.headers["retry-after"]) == 15 * 60

    # Durante o bloqueio, nem o PIN certo entra.
    assert client.post(LOGIN, json=_login_body(ruth, PIN_RUTH)).status_code == 423
    clock.advance(minutes=14, seconds=59)
    assert client.post(LOGIN, json=_login_body(ruth, PIN_RUTH)).status_code == 423

    clock.advance(seconds=2)
    assert client.post(LOGIN, json=_login_body(ruth, PIN_RUTH)).status_code == 200
    db.refresh(ruth)
    assert ruth.failed_attempts == 0
    assert ruth.locked_until is None


def test_lock_is_per_user(
    clock: Clock, auth_users: dict[str, User], new_client: Callable[[], TestClient]
) -> None:
    client = new_client()
    for _ in range(5):
        client.post(LOGIN, json=_login_body(auth_users["ruth"], "000000"))
    assert (
        client.post(LOGIN, json=_login_body(auth_users["matheus"], PIN_MATHEUS)).status_code == 200
    )


def test_after_lock_expires_user_gets_a_fresh_round_of_attempts(
    clock: Clock, auth_users: dict[str, User], new_client: Callable[[], TestClient]
) -> None:
    client = new_client()
    ruth = auth_users["ruth"]
    for _ in range(5):
        client.post(LOGIN, json=_login_body(ruth, "000000"))
    clock.advance(minutes=16)
    assert client.post(LOGIN, json=_login_body(ruth, "000000")).status_code == 401  # não 423


def test_success_resets_failed_attempts(
    db: Session, auth_users: dict[str, User], new_client: Callable[[], TestClient]
) -> None:
    client = new_client()
    ruth = auth_users["ruth"]
    for _ in range(3):
        client.post(LOGIN, json=_login_body(ruth, "000000"))
    db.refresh(ruth)
    assert ruth.failed_attempts == 3
    assert client.post(LOGIN, json=_login_body(ruth, PIN_RUTH)).status_code == 200
    db.refresh(ruth)
    assert ruth.failed_attempts == 0
    for _ in range(4):  # sem o reset isso travaria (3 + 4 >= 5)
        assert client.post(LOGIN, json=_login_body(ruth, "000000")).status_code == 401


# --- /auth/me, sessão, expiração, renovação ---------------------------------------------


def test_me_and_owner_mapping(login: Callable[..., TestClient]) -> None:
    assert login("matheus").get("/api/auth/me").json()["owner"] == "MATHEUS"
    body = login("ruth").get("/api/auth/me").json()
    assert body["owner"] == "RUTH"
    assert body["role"] == "member"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/auth/me"),
        ("post", "/api/auth/logout"),
        ("get", "/api/auth/sessions"),
        ("delete", "/api/auth/sessions/1"),
        ("get", "/_teste/admin"),
    ],
)
def test_protected_routes_without_cookie_are_401(
    new_client: Callable[[], TestClient], method: str, path: str
) -> None:
    assert getattr(new_client(), method)(path).status_code == 401


def test_invalid_cookie_is_401(new_client: Callable[[], TestClient]) -> None:
    client = new_client()
    client.cookies.set("session", "token-que-nao-existe")
    assert client.get("/api/auth/me").status_code == 401


def test_session_expires_after_30_days(clock: Clock, login: Callable[..., TestClient]) -> None:
    client = login("ruth")
    clock.advance(days=29, hours=23)
    assert client.get("/api/auth/me").status_code == 200  # renovou aqui
    clock.advance(days=30, seconds=1)
    assert client.get("/api/auth/me").status_code == 401


def test_session_is_renewed_on_use(
    db: Session, clock: Clock, login: Callable[..., TestClient]
) -> None:
    client = login("ruth")
    for _ in range(3):  # 3 × 20 dias = 60 dias > 30, mas sempre usada antes de expirar
        clock.advance(days=20)
        assert client.get("/api/auth/me").status_code == 200
    db.expire_all()
    session = db.scalars(select(UserSession)).one()
    assert session.expires_at == clock.now + timedelta(days=30)


def test_me_renews_the_cookie(login: Callable[..., TestClient]) -> None:
    response = login("ruth").get("/api/auth/me")
    assert "max-age=2592000" in response.headers["set-cookie"].lower()


# --- logout e revogação --------------------------------------------------------------------


def test_logout_revokes_session(db: Session, login: Callable[..., TestClient]) -> None:
    client = login("ruth")
    token = client.cookies["session"]
    assert client.post("/api/auth/logout").status_code == 204
    db.expire_all()
    assert db.scalars(select(UserSession)).one().revoked_at is not None

    replay = login_client_with_token(client, token)
    assert replay.get("/api/auth/me").status_code == 401


def login_client_with_token(like: TestClient, token: str) -> TestClient:
    other = TestClient(like.app, base_url="https://testserver")
    other.cookies.set("session", token)
    return other


def test_list_sessions_marks_current_and_hides_revoked(
    login: Callable[..., TestClient],
) -> None:
    phone = login("ruth", "Celular")
    tablet = login("ruth", "Tablet")
    login("matheus", "PC do Matheus")  # de outro usuário: não aparece

    sessions = phone.get("/api/auth/sessions").json()
    assert [(s["device_label"], s["current"]) for s in sessions] == [
        ("Tablet", False),
        ("Celular", True),
    ]
    assert set(sessions[0]) == {"id", "device_label", "created_at", "expires_at", "current"}

    tablet_id = sessions[0]["id"]
    assert phone.delete(f"/api/auth/sessions/{tablet_id}").status_code == 204
    assert [s["device_label"] for s in phone.get("/api/auth/sessions").json()] == ["Celular"]
    assert tablet.get("/api/auth/me").status_code == 401


def test_user_revokes_own_session_and_it_is_audited(
    db: Session, login: Callable[..., TestClient]
) -> None:
    ruth = login("ruth", "Celular")
    other = login("ruth", "Tablet")
    target = next(s for s in ruth.get("/api/auth/sessions").json() if not s["current"])

    assert ruth.delete(f"/api/auth/sessions/{target['id']}").status_code == 204
    assert other.get("/api/auth/me").status_code == 401

    entries = _audit(db, "sessions")
    assert len(entries) == 1
    assert entries[0].entity_id == str(target["id"])
    assert entries[0].action == "update"
    assert entries[0].after_json["revoked_at"] is not None


def test_admin_revokes_any_users_session(
    db: Session, login: Callable[..., TestClient], auth_users: dict[str, User]
) -> None:
    ruth = login("ruth")
    matheus = login("matheus")
    ruth_session = db.scalars(
        select(UserSession).where(UserSession.user_id == auth_users["ruth"].id)
    ).one()

    assert matheus.delete(f"/api/auth/sessions/{ruth_session.id}").status_code == 204
    assert ruth.get("/api/auth/me").status_code == 401
    assert matheus.get("/api/auth/me").status_code == 200
    entry = _audit(db, "sessions")[0]
    assert entry.user_id == auth_users["matheus"].id  # quem revogou


def test_member_cannot_revoke_admin_session(
    db: Session, login: Callable[..., TestClient], auth_users: dict[str, User]
) -> None:
    ruth = login("ruth")
    matheus = login("matheus")
    matheus_session = db.scalars(
        select(UserSession).where(UserSession.user_id == auth_users["matheus"].id)
    ).one()

    assert ruth.delete(f"/api/auth/sessions/{matheus_session.id}").status_code == 403
    assert matheus.get("/api/auth/me").status_code == 200
    assert _audit(db, "sessions") == []


def test_revoke_unknown_session_is_404(login: Callable[..., TestClient]) -> None:
    assert login("ruth").delete("/api/auth/sessions/999999").status_code == 404


def test_require_admin(login: Callable[..., TestClient]) -> None:
    assert login("ruth").get("/_teste/admin").status_code == 403
    assert login("matheus").get("/_teste/admin").json() == {"name": "Matheus"}


# --- troca de PIN, usuários iniciais e auditoria -------------------------------------------


def test_change_pin_resets_lock_and_is_audited_without_secrets(
    db: Session, auth_users: dict[str, User], new_client: Callable[[], TestClient]
) -> None:
    ruth, matheus = auth_users["ruth"], auth_users["matheus"]
    ruth.failed_attempts = 3
    old_hash = ruth.pin_hash
    service.change_pin(db, ruth, "246810", actor_id=matheus.id)

    assert ruth.pin_hash != old_hash
    assert ruth.failed_attempts == 0
    client = new_client()
    assert client.post(LOGIN, json=_login_body(ruth, PIN_RUTH)).status_code == 401
    assert client.post(LOGIN, json=_login_body(ruth, "246810")).status_code == 200

    entry = _audit(db, "users")[0]
    assert (entry.action, entry.user_id, entry.entity_id) == ("update", matheus.id, str(ruth.id))
    dumped = json.dumps([entry.before_json, entry.after_json])
    assert "246810" not in dumped
    assert "argon2" not in dumped
    assert "pin_hash" not in dumped


def test_change_pin_rejects_invalid_pin(db: Session, auth_users: dict[str, User]) -> None:
    with pytest.raises(ValueError, match="6 dígitos"):
        service.change_pin(db, auth_users["ruth"], "12", actor_id=None)


def _settings(matheus: str, ruth: str) -> Settings:
    return Settings(initial_pin_matheus=matheus, initial_pin_ruth=ruth)


def test_ensure_initial_users_creates_and_is_idempotent(db: Session) -> None:
    settings = _settings("111111", "222222")
    assert service.ensure_initial_users(db, settings) == ["Matheus", "Ruth"]
    assert service.ensure_initial_users(db, settings) == []

    db.expire_all()
    rows = {u.name: u for u in db.scalars(select(User))}
    assert (rows["Matheus"].role, rows["Ruth"].role) == ("admin", "member")
    assert rows["Matheus"].pin_hash.startswith("$argon2")
    assert service.hash_pin("111111") != rows["Matheus"].pin_hash  # salt aleatório
    assert service._verify_pin(rows["Ruth"].pin_hash, "222222")

    entries = _audit(db, "users")
    assert len(entries) == 2  # criação auditada uma única vez por usuário
    assert {e.action for e in entries} == {"create"}
    dumped = json.dumps([[e.before_json, e.after_json] for e in entries])
    assert "111111" not in dumped
    assert "argon2" not in dumped


def test_ensure_initial_users_skips_empty_or_invalid_pin_without_leaking(
    db: Session, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.WARNING)
    created = service.ensure_initial_users(db, _settings("", "12ab"))
    assert created == []
    assert db.scalars(select(User)).first() is None
    assert "Matheus" in caplog.text
    assert "12ab" not in caplog.text


def test_ensure_initial_users_does_not_touch_existing_user(db: Session) -> None:
    service.ensure_initial_users(db, _settings("111111", ""))  # só Matheus
    assert [u.name for u in db.scalars(select(User))] == ["Matheus"]
    original = db.scalars(select(User)).one().pin_hash
    assert service.ensure_initial_users(db, _settings("999999", "222222")) == ["Ruth"]
    db.expire_all()
    matheus = db.scalars(select(User).where(User.name == "Matheus")).one()
    assert matheus.pin_hash == original  # PIN do existente não é sobrescrito
