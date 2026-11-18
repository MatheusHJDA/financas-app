"""Códigos de liberação (24 h) e de emergência (sem validade). Só o `sha256` vai ao banco.

Nada aqui faz commit. A auditoria nunca guarda o código nem o hash.
"""

import hashlib
import secrets
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from finance_api.core.audit import record_audit
from finance_api.db.models import AccessCode, User

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
RELEASE_TTL = timedelta(hours=24)
RECOVERY_COUNT = 8
_CODE_LENGTH = 10


def normalize_code(raw: str) -> str:
    return raw.replace("-", "").replace(" ", "").upper()


def format_code(code: str) -> str:
    return f"{code[:5]}-{code[5:]}"


def hash_code(raw: str) -> str:
    return hashlib.sha256(normalize_code(raw).encode()).hexdigest()


def _generate() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(_CODE_LENGTH))


def issue_release_code(
    db: Session, user: User, *, actor_id: int | None, now: datetime
) -> tuple[str, datetime]:
    code = _generate()
    expires_at = now + RELEASE_TTL
    row = AccessCode(
        user_id=user.id,
        kind="release",
        code_hash=hash_code(code),
        expires_at=expires_at,
        created_by=actor_id,
    )
    db.add(row)
    db.flush()
    record_audit(
        db,
        user_id=actor_id,
        entity="access_codes",
        entity_id=row.id,
        action="create",
        after={"user_id": user.id, "kind": "release"},
    )
    return format_code(code), expires_at


def issue_recovery_codes(db: Session, user: User, *, now: datetime) -> list[str]:
    """Troca os códigos de emergência não usados do usuário por 8 novos."""
    db.execute(
        delete(AccessCode).where(
            AccessCode.user_id == user.id,
            AccessCode.kind == "recovery",
            AccessCode.used_at.is_(None),
        )
    )
    raw: set[str] = set()
    while len(raw) < RECOVERY_COUNT:
        raw.add(_generate())
    db.add_all(
        AccessCode(user_id=user.id, kind="recovery", code_hash=hash_code(c), created_by=user.id)
        for c in raw
    )
    db.flush()
    record_audit(
        db,
        user_id=user.id,
        entity="access_codes",
        entity_id=user.id,
        action="create",
        after={"user_id": user.id, "kind": "recovery", "count": len(raw)},
    )
    return [format_code(c) for c in raw]


def consume_code(db: Session, user: User, code_hash: str, now: datetime) -> AccessCode | None:
    row = db.scalars(
        select(AccessCode)
        .where(
            AccessCode.user_id == user.id,
            AccessCode.code_hash == code_hash,
            AccessCode.used_at.is_(None),
            (AccessCode.expires_at.is_(None)) | (AccessCode.expires_at > now),
        )
        .order_by(AccessCode.id)
        .limit(1)
        .with_for_update()
    ).first()
    if row is None:
        return None
    row.used_at = now
    record_audit(
        db,
        user_id=user.id,
        entity="access_codes",
        entity_id=row.id,
        action="update",
        after={"kind": row.kind, "used": True},
    )
    return row
