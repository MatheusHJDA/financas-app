import json
import os
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from finance_api.core import app_settings
from finance_api.core.audit import record_audit
from finance_api.core.permissions import CurrentUser
from finance_api.db.models import AiExtraction, AuditLog, Setting, User, UserSession

from .conftest import NEW_PIN, PIN_MATHEUS, PIN_RUTH

Users = dict[str, CurrentUser]
Login = Callable[..., TestClient]


def _audit(db: Session, entity: str) -> list[AuditLog]:
    db.expire_all()
    return list(db.scalars(select(AuditLog).where(AuditLog.entity == entity).order_by(AuditLog.id)))


def _login_status(client: TestClient, user: User, pin: str) -> int:
    return client.post(
        "/api/auth/login",
        json={"name": user.name, "pin": pin, "device_label": "Outro aparelho"},
    ).status_code


# --- permissão -----------------------------------------------------------------------------

ADMIN_ROUTES: list[tuple[str, str, dict[str, Any] | None]] = [
    ("GET", "/api/admin/users", None),
    ("POST", "/api/admin/users/1/reset-pin", {"new_pin": "123456"}),
    ("POST", "/api/admin/users/1/reset-pin", {"new_pin": "12"}),
    ("POST", "/api/admin/users/1/release-code", None),
    ("POST", "/api/admin/users/1/unlock", None),
    ("GET", "/api/admin/users/1/passkeys", None),
    ("DELETE", "/api/admin/users/1/sessions", None),
    ("GET", "/api/admin/settings", None),
    ("PUT", "/api/admin/settings", {"notify.daily_time": "20:00"}),
    ("PUT", "/api/admin/settings", {"chave.desconhecida": 1}),
    ("GET", "/api/admin/ai/calls", None),
    ("GET", "/api/admin/audit", None),
    ("GET", "/api/admin/system", None),
    ("GET", "/api/admin/backups/latest", None),
]


@pytest.mark.parametrize(("method", "path", "body"), ADMIN_ROUTES)
def test_member_gets_403(
    client_as: Callable[[CurrentUser | None], TestClient],
    users: Users,
    method: str,
    path: str,
    body: dict[str, Any] | None,
) -> None:
    response = client_as(users["ruth"]).request(method, path, json=body)
    assert response.status_code == 403


@pytest.mark.parametrize(("method", "path", "body"), ADMIN_ROUTES[:1] + ADMIN_ROUTES[4:5])
def test_anonymous_gets_401(
    new_client: Callable[[], TestClient], method: str, path: str, body: dict[str, Any] | None
) -> None:
    assert new_client().request(method, path, json=body).status_code == 401


# --- usuários ------------------------------------------------------------------------------


def test_list_users_never_exposes_pin_hash(
    client_as: Callable[[CurrentUser | None], TestClient], users: Users
) -> None:
    response = client_as(users["matheus"]).get("/api/admin/users")
    assert response.status_code == 200
    body = response.json()
    assert [u["name"] for u in body] == ["Matheus", "Ruth"]
    assert body[0].keys() == {"id", "name", "role", "failed_attempts", "passkey_count", "locked_at"}
    assert body[1]["role"] == "member"
    assert "pin" not in response.text


def test_reset_pin_new_works_old_does_not_and_audit_is_clean(
    db: Session, login: Login, new_client: Callable[[], TestClient], real_users: dict[str, User]
) -> None:
    admin = login("matheus")
    ruth_device = login("ruth")
    ruth = real_users["ruth"]
    ruth.failed_attempts = 3
    ruth.locked_at = datetime.now(UTC) - timedelta(days=3)
    old_hash = ruth.pin_hash
    db.flush()

    response = admin.post(f"/api/admin/users/{ruth.id}/reset-pin", json={"new_pin": NEW_PIN})
    assert response.status_code == 204

    db.expire_all()
    assert ruth.failed_attempts == 0
    assert ruth.locked_at is None
    assert ruth.pin_hash != old_hash
    # a sessão antiga da Ruth foi revogada
    assert ruth_device.get("/api/auth/me").status_code == 401
    # PIN novo entra; PIN antigo não
    assert _login_status(new_client(), ruth, NEW_PIN) == 200
    assert _login_status(new_client(), ruth, PIN_RUTH) == 401

    entries = _audit(db, "users")
    assert len(entries) == 1
    entry = entries[0]
    assert (entry.user_id, entry.entity_id, entry.action) == (
        real_users["matheus"].id,
        str(ruth.id),
        "update",
    )
    dumped = json.dumps([entry.before_json, entry.after_json])
    assert NEW_PIN not in dumped
    assert ruth.pin_hash not in dumped
    assert old_hash not in dumped
    assert "argon2" not in dumped


def test_reset_own_pin_keeps_current_session_only(
    login: Login, real_users: dict[str, User], new_client: Callable[[], TestClient]
) -> None:
    here = login("matheus")
    elsewhere = login("matheus")
    matheus = real_users["matheus"]

    response = here.post(f"/api/admin/users/{matheus.id}/reset-pin", json={"new_pin": NEW_PIN})
    assert response.status_code == 204
    assert here.get("/api/auth/me").status_code == 200
    assert elsewhere.get("/api/auth/me").status_code == 401
    assert _login_status(new_client(), matheus, PIN_MATHEUS) == 401
    assert _login_status(new_client(), matheus, NEW_PIN) == 200


@pytest.mark.parametrize(
    "pin", ["", "1234", "12345", "1234567", "abcdef", "12 456", "１２３４５６"]
)
def test_reset_pin_requires_exactly_six_digits(
    login: Login,
    new_client: Callable[[], TestClient],
    real_users: dict[str, User],
    db: Session,
    pin: str,
) -> None:
    admin = login("matheus")
    ruth = real_users["ruth"]
    response = admin.post(f"/api/admin/users/{ruth.id}/reset-pin", json={"new_pin": pin})
    assert response.status_code == 422
    if pin:
        assert pin not in response.text
    assert _audit(db, "users") == []
    assert _login_status(new_client(), ruth, PIN_RUTH) == 200


def test_reset_pin_unknown_user_is_404(login: Login) -> None:
    response = login("matheus").post("/api/admin/users/999999/reset-pin", json={"new_pin": NEW_PIN})
    assert response.status_code == 404


def test_revoke_user_sessions(login: Login, real_users: dict[str, User], db: Session) -> None:
    admin = login("matheus")
    phone, tablet = login("ruth"), login("ruth")
    ruth = real_users["ruth"]

    response = admin.delete(f"/api/admin/users/{ruth.id}/sessions")
    assert response.status_code == 204
    assert phone.get("/api/auth/me").status_code == 401
    assert tablet.get("/api/auth/me").status_code == 401
    assert admin.get("/api/auth/me").status_code == 200  # as do admin ficam
    db.expire_all()
    active = db.scalars(
        select(UserSession).where(UserSession.user_id == ruth.id, UserSession.revoked_at.is_(None))
    ).all()
    assert active == []

    entries = _audit(db, "users")
    assert len(entries) == 1
    assert entries[0].after_json == {"sessions_revoked": 2}
    assert "token" not in json.dumps(entries[0].after_json)


def test_revoke_user_sessions_unknown_user_is_404(login: Login) -> None:
    assert login("matheus").delete("/api/admin/users/999999/sessions").status_code == 404


# --- configurações -------------------------------------------------------------------------

VALID = {
    app_settings.DAILY_TIME: "20:30",
    app_settings.BILL_TIME: "08:15",
    app_settings.BILL_DAYS_BEFORE: 3,
}


def test_get_settings_defaults(
    client_as: Callable[[CurrentUser | None], TestClient], users: Users
) -> None:
    response = client_as(users["matheus"]).get("/api/admin/settings")
    assert response.status_code == 200
    assert response.json() == app_settings.DEFAULTS


def test_put_settings_saves_returns_and_audits(
    client_as: Callable[[CurrentUser | None], TestClient], users: Users, db: Session
) -> None:
    client = client_as(users["matheus"])
    response = client.put("/api/admin/settings", json=VALID)
    assert response.status_code == 200
    assert response.json() == VALID
    assert client.get("/api/admin/settings").json() == VALID
    assert app_settings.get(db, app_settings.BILL_DAYS_BEFORE) == 3

    entries = _audit(db, "settings")
    assert len(entries) == 1
    assert entries[0].user_id == users["matheus"].id
    assert entries[0].before_json == app_settings.DEFAULTS
    assert entries[0].after_json == VALID


def test_put_settings_replaces_missing_keys_go_back_to_default(
    client_as: Callable[[CurrentUser | None], TestClient], users: Users, db: Session
) -> None:
    client = client_as(users["matheus"])
    client.put("/api/admin/settings", json=VALID)
    response = client.put("/api/admin/settings", json={app_settings.DAILY_TIME: "22:00"})
    assert response.status_code == 200
    assert response.json() == {**app_settings.DEFAULTS, app_settings.DAILY_TIME: "22:00"}
    assert db.scalars(select(Setting.key)).all() == [app_settings.DAILY_TIME]


@pytest.mark.parametrize(
    "bad",
    [
        {"chave.desconhecida": 1},
        {**VALID, "outra": "x"},
        {app_settings.DAILY_TIME: "24:00"},
        {app_settings.DAILY_TIME: "9:00"},
        {app_settings.BILL_TIME: "12:60"},
        {app_settings.BILL_TIME: 900},
        {app_settings.BILL_TIME: None},
        {app_settings.BILL_DAYS_BEFORE: 11},
        {app_settings.BILL_DAYS_BEFORE: -1},
        {app_settings.BILL_DAYS_BEFORE: "2"},
        {app_settings.BILL_DAYS_BEFORE: 2.5},
        {app_settings.BILL_DAYS_BEFORE: True},
    ],
)
def test_put_settings_invalid_is_422_and_changes_nothing(
    client_as: Callable[[CurrentUser | None], TestClient],
    users: Users,
    db: Session,
    bad: dict[str, Any],
) -> None:
    client = client_as(users["matheus"])
    assert client.put("/api/admin/settings", json=bad).status_code == 422
    assert client.get("/api/admin/settings").json() == app_settings.DEFAULTS
    assert _audit(db, "settings") == []


def test_put_settings_edge_values_ok(
    client_as: Callable[[CurrentUser | None], TestClient], users: Users
) -> None:
    client = client_as(users["matheus"])
    body = {
        app_settings.DAILY_TIME: "00:00",
        app_settings.BILL_TIME: "23:59",
        app_settings.BILL_DAYS_BEFORE: 0,
    }
    assert client.put("/api/admin/settings", json=body).json() == body
    body[app_settings.BILL_DAYS_BEFORE] = 10
    assert client.put("/api/admin/settings", json=body).status_code == 200


# --- IA ------------------------------------------------------------------------------------


def _add_calls(db: Session, user_id: int, count: int) -> list[AiExtraction]:
    base = datetime(2026, 1, 1, tzinfo=UTC)
    rows = [
        AiExtraction(
            user_id=user_id,
            input_kind="text",
            model="modelo-x",
            prompt_version="v1",
            usage_tokens=100 + i,
            est_cost_cents=i,
            status="failed" if i == 2 else "ok",
            error_code="rate_limited" if i == 2 else None,
            raw_output_json={"segredo": "não vai para a API"},
            created_at=base + timedelta(minutes=i),
        )
        for i in range(count)
    ]
    db.add_all(rows)
    db.flush()
    return rows


def test_ai_calls_paginated_newest_first(
    client_as: Callable[[CurrentUser | None], TestClient], users: Users, db: Session
) -> None:
    rows = _add_calls(db, users["ruth"].id, 5)
    client = client_as(users["matheus"])

    page = client.get("/api/admin/ai/calls", params={"limit": 2}).json()
    assert page["total"] == 5
    assert [c["id"] for c in page["items"]] == [rows[4].id, rows[3].id]
    first = page["items"][0]
    assert first.keys() == {
        "id",
        "user_id",
        "input_kind",
        "model",
        "prompt_version",
        "usage_tokens",
        "est_cost_cents",
        "status",
        "error_code",
        "created_at",
    }
    assert first["usage_tokens"] == 104 and first["est_cost_cents"] == 4
    assert first["user_id"] == users["ruth"].id

    second = client.get("/api/admin/ai/calls", params={"limit": 2, "offset": 2}).json()
    assert [c["id"] for c in second["items"]] == [rows[2].id, rows[1].id]
    assert second["items"][0]["status"] == "failed"
    assert second["items"][0]["error_code"] == "rate_limited"
    assert "segredo" not in json.dumps(page)

    last = client.get("/api/admin/ai/calls", params={"limit": 2, "offset": 4}).json()
    assert [c["id"] for c in last["items"]] == [rows[0].id]


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 201}, {"offset": -1}])
def test_pagination_bounds_are_422(
    client_as: Callable[[CurrentUser | None], TestClient], users: Users, params: dict[str, int]
) -> None:
    client = client_as(users["matheus"])
    assert client.get("/api/admin/ai/calls", params=params).status_code == 422
    assert client.get("/api/admin/audit", params=params).status_code == 422


# --- auditoria -----------------------------------------------------------------------------


def test_audit_filters_and_pagination(
    client_as: Callable[[CurrentUser | None], TestClient], users: Users, db: Session
) -> None:
    ids = []
    for i in range(3):
        ids.append(
            record_audit(
                db,
                user_id=users["matheus"].id,
                entity="goals",
                entity_id=i,
                action="create",
                after={"n": i},
            )
        )
    other = record_audit(
        db, user_id=users["ruth"].id, entity="transactions", entity_id=9, action="delete"
    )
    system = record_audit(db, user_id=None, entity="goals", entity_id=7, action="update")
    db.flush()
    client = client_as(users["matheus"])

    everything = client.get("/api/admin/audit").json()
    assert everything["total"] == 5
    assert [e["id"] for e in everything["items"]][:2] == [system.id, other.id]

    goals = client.get("/api/admin/audit", params={"entity": "goals"}).json()
    assert goals["total"] == 4
    assert {e["entity"] for e in goals["items"]} == {"goals"}

    ruth = client.get("/api/admin/audit", params={"user_id": users["ruth"].id}).json()
    assert [e["id"] for e in ruth["items"]] == [other.id]
    assert ruth["items"][0]["before"] is None and ruth["items"][0]["after"] is None

    combo = client.get(
        "/api/admin/audit", params={"entity": "goals", "user_id": users["matheus"].id, "limit": 2}
    ).json()
    assert combo["total"] == 3
    assert [e["id"] for e in combo["items"]] == [ids[2].id, ids[1].id]
    assert combo["items"][0]["after"] == {"n": 2}
    assert combo["items"][0].keys() == {
        "id",
        "user_id",
        "entity",
        "entity_id",
        "action",
        "before",
        "after",
        "at",
    }

    page2 = client.get(
        "/api/admin/audit",
        params={"entity": "goals", "user_id": users["matheus"].id, "limit": 2, "offset": 2},
    ).json()
    assert [e["id"] for e in page2["items"]] == [ids[0].id]
    assert client.get("/api/admin/audit", params={"entity": "nada"}).json() == {
        "items": [],
        "total": 0,
    }


# --- sistema e backup ----------------------------------------------------------------------


def _touch(path: Path, content: bytes, mtime: float) -> None:
    path.write_bytes(content)
    os.utime(path, (mtime, mtime))


def test_system_without_backup_folder(
    app: Any,
    client_as: Callable[[CurrentUser | None], TestClient],
    users: Users,
    tmp_path: Path,
) -> None:
    from finance_api.core.config import Settings, get_settings

    app.dependency_overrides[get_settings] = lambda: Settings(
        backup_dir=str(tmp_path / "nao-existe")
    )
    client = client_as(users["matheus"])
    assert client.get("/api/admin/system").json() == {
        "database_ok": True,
        "scheduler_ok": False,
        "last_backup_at": None,
        "last_backup_size_bytes": None,
    }
    assert client.get("/api/admin/backups/latest").status_code == 404


def test_system_and_download_pick_newest_file(
    client_as: Callable[[CurrentUser | None], TestClient],
    users: Users,
    backup_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = time.time()
    _touch(backup_dir / "financas-20261110-030000.dump", b"velho", now - 3 * 86400)
    _touch(backup_dir / "financas-20261113-030000.dump", b"conteudo-novo", now - 3600)
    (backup_dir / "subpasta").mkdir()  # pastas não contam
    # mais novos, mas fora do padrão do backup.sh: não contam
    _touch(backup_dir / "notas.txt", b"x", now)
    _touch(backup_dir / "financas-20261113-040000.dump.tmp", b"parcial", now)
    monkeypatch.setattr("finance_api.admin.router.lifecycle.scheduler_ok", lambda: True)
    client = client_as(users["matheus"])

    system = client.get("/api/admin/system").json()
    assert system["database_ok"] is True
    assert system["scheduler_ok"] is True
    assert system["last_backup_size_bytes"] == len(b"conteudo-novo")
    at = datetime.fromisoformat(system["last_backup_at"])
    assert abs(at.timestamp() - (now - 3600)) < 2

    response = client.get("/api/admin/backups/latest")
    assert response.status_code == 200
    assert response.content == b"conteudo-novo"
    assert "financas-20261113-030000.dump" in response.headers["content-disposition"]
    assert response.headers["content-type"].startswith("application/octet-stream")


def test_backup_download_ignores_client_supplied_paths(
    client_as: Callable[[CurrentUser | None], TestClient], users: Users, backup_dir: Path
) -> None:
    _touch(backup_dir / "financas-20261113-030000.dump", b"ok", time.time())
    client = client_as(users["matheus"])
    response = client.get("/api/admin/backups/latest", params={"path": "/etc/passwd", "file": "x"})
    assert response.content == b"ok"
    assert client.get("/api/admin/backups/%2e%2e%2f%2e%2e%2fetc%2fpasswd").status_code == 404


def test_backup_ignores_symlinks(
    client_as: Callable[[CurrentUser | None], TestClient],
    users: Users,
    backup_dir: Path,
    tmp_path: Path,
) -> None:
    secret = tmp_path / "segredo.env"
    secret.write_bytes(b"SENHA=1")
    link = backup_dir / "financas-20991231-235959.dump"
    try:
        link.symlink_to(secret)
    except OSError:
        pytest.skip("criar link simbólico exige permissão neste sistema")
    client = client_as(users["matheus"])
    assert client.get("/api/admin/backups/latest").status_code == 404
    assert client.get("/api/admin/system").json()["last_backup_at"] is None


def test_admin_generates_release_code_without_leaking_it(
    login: Login, real_users: dict[str, User], db: Session
) -> None:
    response = login("matheus").post(f"/api/admin/users/{real_users['ruth'].id}/release-code")
    assert response.status_code == 201
    body = response.json()
    assert len(body["code"]) == 11
    rows = _audit(db, "access_codes")
    assert len(rows) == 1
    dump = json.dumps([r.after_json for r in rows])
    assert body["code"] not in dump
    assert body["code"].replace("-", "") not in dump
    assert rows[0].user_id == real_users["matheus"].id


def test_release_code_unknown_user_404(login: Login) -> None:
    assert login("matheus").post("/api/admin/users/99999/release-code").status_code == 404
