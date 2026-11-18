"""Limites de tentativas: por origem (5 / 15 min) e por conta (20 / 1 h, trava sem prazo)."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import Engine, select, text
from sqlalchemy.orm import Session
from starlette.requests import Request

from finance_api.auth import limits
from finance_api.db.models import AuditLog, AuthFailure, User

T0 = datetime(2026, 11, 18, 12, 0, tzinfo=UTC)


def _request(client: tuple[str, int] | None) -> Request:
    return Request({"type": "http", "method": "POST", "path": "/", "headers": [], "client": client})


def test_constants() -> None:
    assert limits.SOURCE_MAX_FAILURES == 5
    assert limits.SOURCE_WINDOW == timedelta(minutes=15)
    assert limits.ACCOUNT_MAX_FAILURES == 20
    assert limits.ACCOUNT_WINDOW == timedelta(hours=1)


def test_request_source_uses_client_host_truncated() -> None:
    assert limits.request_source(_request(("10.0.0.2", 50000))) == "10.0.0.2"
    assert limits.request_source(_request(("a" * 100, 1))) == "a" * 64
    assert limits.request_source(_request(None)) == "desconhecida"


def test_source_blocked_after_five_failures_until_window_passes(db: Session) -> None:
    for minute in range(5):
        assert limits.source_retry_after(db, "1.1.1.1", T0 + timedelta(minutes=minute)) is None
        limits.record_failure(db, source="1.1.1.1", user=None, now=T0 + timedelta(minutes=minute))
    now = T0 + timedelta(minutes=5)
    # a mais antiga das 5 (T0) sai da janela em T0 + 15 min
    assert limits.source_retry_after(db, "1.1.1.1", now) == 10 * 60
    assert limits.source_retry_after(db, "2.2.2.2", now) is None
    assert limits.source_retry_after(db, "1.1.1.1", T0 + timedelta(minutes=15, seconds=1)) is None


def test_account_locks_at_20_failures_in_one_hour_and_is_audited(db: Session) -> None:
    ruth = User(name="Ruth", role="member", pin_hash="!x")
    db.add(ruth)
    db.flush()
    for i in range(19):
        limits.record_failure(
            db, source=f"origem-{i % 4}", user=ruth, now=T0 + timedelta(minutes=i)
        )
    assert ruth.failed_attempts == 19
    assert not limits.is_locked(ruth)

    limits.record_failure(db, source="origem-x", user=ruth, now=T0 + timedelta(minutes=30))
    assert ruth.failed_attempts == 20
    assert ruth.locked_at == T0 + timedelta(minutes=30)
    assert limits.is_locked(ruth)
    audit = db.scalars(select(AuditLog).where(AuditLog.entity == "users")).all()
    assert [(a.action, a.entity_id, a.after_json) for a in audit] == [
        ("update", str(ruth.id), {"locked": True})
    ]
    assert len(db.scalars(select(AuthFailure)).all()) == 20

    # mais erros depois de travada não auditam de novo
    limits.record_failure(db, source="origem-x", user=ruth, now=T0 + timedelta(minutes=31))
    assert len(db.scalars(select(AuditLog).where(AuditLog.entity == "users")).all()) == 1


def test_account_failures_outside_window_do_not_count(db: Session) -> None:
    ruth = User(name="Ruth", role="member", pin_hash="!x")
    db.add(ruth)
    db.flush()
    for i in range(19):
        limits.record_failure(db, source="o", user=ruth, now=T0 + timedelta(minutes=i))
    later = T0 + timedelta(hours=1, minutes=10)  # as de 0 a 10 min saíram; ficam 11..18 + esta
    limits.record_failure(db, source="o", user=ruth, now=later)
    assert ruth.failed_attempts == 9
    assert not limits.is_locked(ruth)


def test_release_account_clears_lock_and_account_count_but_keeps_source_count(
    db: Session,
) -> None:
    ruth = User(name="Ruth", role="member", pin_hash="!x")
    db.add(ruth)
    db.flush()
    for i in range(20):
        limits.record_failure(db, source="o", user=ruth, now=T0 + timedelta(seconds=i))
    assert limits.is_locked(ruth)

    limits.release_account(db, ruth)
    assert ruth.locked_at is None
    assert ruth.failed_attempts == 0
    limits.record_failure(db, source="o", user=ruth, now=T0 + timedelta(minutes=1))
    assert ruth.failed_attempts == 1  # as falhas antigas não somam de novo para a conta
    assert not limits.is_locked(ruth)
    assert limits.source_retry_after(db, "o", T0 + timedelta(minutes=1)) is not None


def test_lock_source_serializes_the_same_source_only(db: Session, db_engine: Engine) -> None:
    limits.lock_source(db, "9.9.9.9")
    with db_engine.connect() as other:
        try_lock = text("SELECT pg_try_advisory_xact_lock(:ns, hashtext(:source))")
        same = other.scalar(try_lock, {"ns": limits.SOURCE_LOCK_NAMESPACE, "source": "9.9.9.9"})
        different = other.scalar(
            try_lock, {"ns": limits.SOURCE_LOCK_NAMESPACE, "source": "8.8.8.8"}
        )
        other.rollback()
    assert same is False  # preso até o commit/rollback de quem chamou
    assert different is True
