import re

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from finance_api.auth import codes, release, service
from finance_api.db.models import AccessCode, AuditLog, AuthFailure, User

from .conftest import Clock

FORMAT = re.compile(r"^[A-HJ-KM-NP-Z2-9]{5}-[A-HJ-KM-NP-Z2-9]{5}$")
CLI_LINE = re.compile(
    r"Código de liberação para Matheus: (\S+) \(vale até \d\d/\d\d/\d{4} \d\d:\d\d\)"
)


def test_format_and_normalize() -> None:
    assert codes.normalize_code(" abcde-fghjk ") == "ABCDEFGHJK"
    assert codes.format_code("ABCDEFGHJK") == "ABCDE-FGHJK"
    assert codes.hash_code("abcde-fghjk") == codes.hash_code("ABCDEFGHJK")


def test_release_code_single_use(db: Session, auth_users: dict[str, User], clock: Clock) -> None:
    matheus = auth_users["matheus"]
    code, expires = codes.issue_release_code(db, matheus, actor_id=None, now=clock.now)
    assert FORMAT.match(code)
    assert expires == clock.now + codes.RELEASE_TTL
    assert codes.consume_code(db, matheus, codes.hash_code(code.lower()), clock.now) is not None
    assert codes.consume_code(db, matheus, codes.hash_code(code), clock.now) is None


def test_release_code_expires(db: Session, auth_users: dict[str, User], clock: Clock) -> None:
    matheus = auth_users["matheus"]
    code, _ = codes.issue_release_code(db, matheus, actor_id=None, now=clock.now)
    clock.advance(hours=24, seconds=1)
    assert codes.consume_code(db, matheus, codes.hash_code(code), clock.now) is None


def test_code_is_per_user(db: Session, auth_users: dict[str, User], clock: Clock) -> None:
    code, _ = codes.issue_release_code(db, auth_users["ruth"], actor_id=None, now=clock.now)
    assert codes.consume_code(db, auth_users["matheus"], codes.hash_code(code), clock.now) is None


def test_recovery_codes(db: Session, auth_users: dict[str, User], clock: Clock) -> None:
    matheus = auth_users["matheus"]
    first = codes.issue_recovery_codes(db, matheus, now=clock.now)
    assert len(set(first)) == codes.RECOVERY_COUNT
    assert all(FORMAT.match(c) for c in first)
    second = codes.issue_recovery_codes(db, matheus, now=clock.now)
    assert set(first).isdisjoint(second)
    assert codes.consume_code(db, matheus, codes.hash_code(first[0]), clock.now) is None
    row = codes.consume_code(db, matheus, codes.hash_code(second[0]), clock.now)
    assert row is not None
    assert row.kind == "recovery"
    assert row.expires_at is None
    clock.advance(days=400)
    assert codes.consume_code(db, matheus, codes.hash_code(second[1]), clock.now) is not None


def test_database_has_only_hashes(db: Session, auth_users: dict[str, User], clock: Clock) -> None:
    matheus = auth_users["matheus"]
    code, _ = codes.issue_release_code(db, matheus, actor_id=matheus.id, now=clock.now)
    recovery = codes.issue_recovery_codes(db, matheus, now=clock.now)
    db.flush()
    rows = db.execute(text("SELECT row_to_json(a)::text FROM access_codes a")).scalars().all()
    audit = db.execute(text("SELECT row_to_json(a)::text FROM audit_log a")).scalars().all()
    blob = "\n".join([*rows, *audit])
    audit_blob = "\n".join(audit)
    for c in [code, *recovery]:
        assert c not in blob
        assert c.replace("-", "") not in blob
        assert codes.hash_code(c) not in audit_blob


def test_cli_prints_release_code(
    db: Session, auth_users: dict[str, User], clock: Clock, capsys: pytest.CaptureFixture[str]
) -> None:
    assert release.main(["Matheus"], db=db) == 0
    match = CLI_LINE.search(capsys.readouterr().out)
    assert match
    assert FORMAT.match(match.group(1))
    uid = auth_users["matheus"].id
    rows = db.scalars(select(AccessCode).where(AccessCode.user_id == uid)).all()
    assert len(rows) == 1
    assert rows[0].code_hash == codes.hash_code(match.group(1))


def test_cli_unknown_name(
    db: Session, auth_users: dict[str, User], capsys: pytest.CaptureFixture[str]
) -> None:
    assert release.main(["Fulano"], db=db) == 1
    assert "Fulano" in capsys.readouterr().out
    assert db.scalars(select(AccessCode)).all() == []


def test_cli_unlock(
    db: Session, auth_users: dict[str, User], clock: Clock, capsys: pytest.CaptureFixture[str]
) -> None:
    matheus = auth_users["matheus"]
    matheus.locked_at = clock.now
    matheus.failed_attempts = 20
    db.add(AuthFailure(source="x", user_id=matheus.id, at=clock.now))
    db.flush()
    assert release.main(["Matheus", "--desbloquear"], db=db) == 0
    assert capsys.readouterr().out.strip() == "Conta de Matheus desbloqueada."
    db.refresh(matheus)
    assert matheus.locked_at is None
    assert matheus.failed_attempts == 0
    assert db.scalars(select(AccessCode)).all() == []
    log = db.scalars(select(AuditLog).where(AuditLog.entity == "users")).all()
    assert len(log) == 1
    assert log[0].user_id is None
    assert log[0].before_json == {"locked": True}
    assert log[0].after_json == {"locked": False}
    assert service.find_user_by_name(db, "matheus") is not None
