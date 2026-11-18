"""Regras de PIN, limites de tentativa e sessões por aparelho (sem rotas FastAPI)."""

import hashlib
import logging
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from finance_api.auth import limits
from finance_api.auth.identity import INITIAL_USERS, OWNER_BY_USER_NAME, PIN_LENGTH
from finance_api.core.audit import record_audit
from finance_api.core.config import Settings
from finance_api.core.permissions import CurrentUser
from finance_api.db.models import User, UserSession

logger = logging.getLogger(__name__)

SESSION_COOKIE = "session"

_hasher = PasswordHasher()
_dummy_hash: str | None = None


def utcnow() -> datetime:
    """Relógio da autenticação (os testes o substituem para simular o tempo)."""
    return datetime.now(UTC)


def is_valid_pin(pin: str) -> bool:
    return len(pin) == PIN_LENGTH and pin.isascii() and pin.isdigit()


def hash_pin(pin: str) -> str:
    return _hasher.hash(pin)


def _verify_pin(pin_hash: str, pin: str) -> bool:
    try:
        return _hasher.verify(pin_hash, pin)
    except (VerificationError, InvalidHashError):
        return False


def _burn_time(pin: str) -> None:
    """Gasta o tempo de uma verificação quando o usuário não existe (evita enumeração)."""
    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = _hasher.hash("000000")
    _verify_pin(_dummy_hash, pin)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


# --- login ---------------------------------------------------------------------------------


class InvalidCredentials(Exception):
    """Falha genérica: nome errado, PIN errado ou conta travada (a resposta é a mesma)."""


class SourceBlocked(Exception):
    def __init__(self, retry_after_seconds: int) -> None:
        super().__init__("source blocked")
        self.retry_after_seconds = retry_after_seconds


@dataclass(frozen=True)
class LoginResult:
    token: str  # texto puro: só vai para o cookie, nunca é gravado
    user: User
    session: UserSession


def find_user_by_name(db: Session, name: str, *, for_update: bool = False) -> User | None:
    """Usuário pelo nome digitado: sem espaços nas pontas, sem diferenciar maiúsculas."""
    typed = name.strip().lower()
    if not typed:
        return None
    query = select(User).where(func.lower(User.name) == typed)
    if for_update:
        query = query.with_for_update()
    user = db.execute(query).scalar_one_or_none()
    if user is None or user.name not in OWNER_BY_USER_NAME:
        return None
    return user


def login(
    db: Session, *, name: str, pin: str, device_label: str, source: str, settings: Settings
) -> LoginResult:
    now = utcnow()
    # Origem bloqueada: recusa antes de qualquer argon2.
    retry = limits.source_retry_after(db, source, now)
    if retry is not None:
        raise SourceBlocked(retry)

    # FOR UPDATE: tentativas paralelas na mesma conta não driblam a contagem.
    user = find_user_by_name(db, name, for_update=True)
    if user is None:
        _burn_time(pin)
        limits.record_failure(db, source=source, user=None, now=now)
        db.commit()
        raise InvalidCredentials

    pin_ok = is_valid_pin(pin) and _verify_pin(user.pin_hash, pin)
    if limits.is_locked(user) or not pin_ok:
        limits.record_failure(db, source=source, user=user, now=now)
        db.commit()
        raise InvalidCredentials

    token = secrets.token_urlsafe(32)
    session = UserSession(
        token_hash=hash_token(token),
        user_id=user.id,
        device_label=device_label,
        expires_at=now + timedelta(days=settings.session_days),
    )
    db.add(session)
    db.commit()
    return LoginResult(token=token, user=user, session=session)


# --- sessões -------------------------------------------------------------------------------


def find_active_session(db: Session, token: str | None, now: datetime) -> UserSession | None:
    if not token:
        return None
    session = db.execute(
        select(UserSession).where(UserSession.token_hash == hash_token(token))
    ).scalar_one_or_none()
    if session is None or session.revoked_at is not None or _aware(session.expires_at) <= now:
        return None
    return session


def to_current_user(user: User) -> CurrentUser | None:
    owner = OWNER_BY_USER_NAME.get(user.name)
    if owner is None or user.role not in ("admin", "member"):
        return None
    return CurrentUser(id=user.id, name=user.name, role=user.role, owner=owner)  # type: ignore[arg-type]


def authenticate_token(db: Session, token: str | None, settings: Settings) -> CurrentUser | None:
    """Valida o cookie (hash, expiração, revogação), renova a validade e devolve o usuário."""
    now = utcnow()
    session = find_active_session(db, token, now)
    if session is None:
        return None
    user = db.get(User, session.user_id)
    current = to_current_user(user) if user is not None else None
    if current is None:
        return None
    session.expires_at = now + timedelta(days=settings.session_days)
    db.commit()
    return current


def revoke_session(db: Session, session: UserSession, *, actor_id: int, audit: bool = True) -> None:
    """Marca revoked_at e audita (sem token nem hash). Idempotente. Não faz commit."""
    if session.revoked_at is not None:
        return
    now = utcnow()
    session.revoked_at = now
    if audit:
        record_audit(
            db,
            user_id=actor_id,
            entity="sessions",
            entity_id=session.id,
            action="update",
            before={"user_id": session.user_id, "revoked_at": None},
            after={"user_id": session.user_id, "revoked_at": now.isoformat()},
        )


# --- usuários e PIN ------------------------------------------------------------------------


def change_pin(db: Session, user: User, new_pin: str, *, actor_id: int | None) -> None:
    """Troca/reseta o PIN, destrava a conta e audita (sem gravar PIN nem hash)."""
    if not is_valid_pin(new_pin):
        raise ValueError(f"O PIN deve ter {PIN_LENGTH} dígitos.")
    user.pin_hash = hash_pin(new_pin)
    limits.release_account(db, user)
    record_audit(
        db,
        user_id=actor_id,
        entity="users",
        entity_id=user.id,
        action="update",
        before={"pin_changed": False},
        after={"pin_changed": True},
    )
    db.commit()


def ensure_initial_users(db: Session, settings: Settings) -> list[str]:
    """Cria Matheus (admin) e Ruth (member) se ainda não existirem. Idempotente.

    PIN ausente ou inválido → não cria e avisa (sem mostrar o valor). Devolve os nomes criados.
    """
    pins = {"Matheus": settings.initial_pin_matheus, "Ruth": settings.initial_pin_ruth}
    created: list[str] = []
    for name, role in INITIAL_USERS:
        if db.execute(select(User.id).where(User.name == name)).first() is not None:
            continue
        pin = pins[name]
        if not is_valid_pin(pin):
            logger.warning(
                "Usuário %s não criado: INITIAL_PIN ausente ou inválido (precisa de %d dígitos).",
                name,
                PIN_LENGTH,
            )
            continue
        user = User(name=name, role=role, pin_hash=hash_pin(pin))
        db.add(user)
        db.flush()
        record_audit(
            db,
            user_id=None,
            entity="users",
            entity_id=user.id,
            action="create",
            after={"name": name, "role": role},
        )
        created.append(name)
    db.commit()
    return created
