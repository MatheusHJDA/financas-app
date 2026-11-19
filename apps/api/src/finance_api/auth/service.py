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


# PINs muito usados que não caem nas regras de repetição/sequência (teclado, espelho, pares).
_COMMON_PINS = frozenset(
    {
        "112233",
        "332211",
        "111222",
        "000111",
        "123321",
        "654456",
        "102030",
        "121314",
        "147258",
        "258369",
        "159753",
        "159357",
        "147852",
        "123654",
        "789456",
        "456123",
    }
)

WEAK_PIN_MESSAGE = (
    "PIN fácil demais: evite sequências (123456), repetições (111111) e padrões (121212)."
)


def is_weak_pin(pin: str) -> bool:
    """PIN fácil de adivinhar. Vale só para criar/trocar PIN; o login aceita os PINs já gravados."""
    if pin in _COMMON_PINS or len(set(pin)) == 1:
        return True
    steps = {(int(b) - int(a)) % 10 for a, b in zip(pin, pin[1:], strict=False)}
    if steps in ({1}, {9}):  # sequência subindo ou descendo (com volta: 890123)
        return True
    return any(pin == (pin[:n] * len(pin))[: len(pin)] for n in (2, 3))


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
    # Uma tentativa por vez da mesma origem (pedidos paralelos não driblam o limite);
    # a trava vale até o commit/rollback abaixo. Origem bloqueada: recusa antes de qualquer argon2.
    limits.lock_source(db, source)
    retry = limits.source_retry_after(db, source, now)
    if retry is not None:
        db.rollback()
        raise SourceBlocked(retry)

    # FOR UPDATE: tentativas paralelas na mesma conta não driblam a contagem.
    user = find_user_by_name(db, name, for_update=True)
    if user is None:
        _burn_time(pin)
        limits.record_failure(db, source=source, user=None, now=now)
        db.commit()
        raise InvalidCredentials

    # argon2 sempre roda (mesmo com PIN malformado): o tempo não revela se o nome existe.
    verified = _verify_pin(user.pin_hash, pin)
    pin_ok = verified and is_valid_pin(pin)
    if limits.is_locked(user) or not pin_ok:
        limits.record_failure(db, source=source, user=user, now=now)
        db.commit()
        raise InvalidCredentials

    token, session = open_session(
        db, user, device_label=device_label, two_factor=False, settings=settings
    )
    db.commit()
    return LoginResult(token=token, user=user, session=session)


# --- sessões -------------------------------------------------------------------------------


def open_session(
    db: Session, user: User, *, device_label: str, two_factor: bool, settings: Settings
) -> tuple[str, UserSession]:
    """Cria a sessão do aparelho (não faz commit). Devolve o token puro, só para o cookie.

    Chave exigida: 30 min sem uso, 12 h no máximo. Sem ela: `session_days` renováveis.
    """
    now = utcnow()
    token = secrets.token_urlsafe(32)
    if settings.require_passkey:
        expires_at = now + timedelta(minutes=settings.session_idle_minutes)
        max_expires_at: datetime | None = now + timedelta(hours=settings.session_max_hours)
    else:
        expires_at = now + timedelta(days=settings.session_days)
        max_expires_at = None
    session = UserSession(
        token_hash=hash_token(token),
        user_id=user.id,
        device_label=device_label,
        expires_at=expires_at,
        two_factor=two_factor,
        max_expires_at=max_expires_at,
    )
    db.add(session)
    db.flush()
    return token, session


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
    if settings.require_passkey:
        # Só valem sessões abertas com as duas etapas (as só-PIN do banco antigo não).
        if not session.two_factor or session.max_expires_at is None:
            return None
        idle = now + timedelta(minutes=settings.session_idle_minutes)
        session.expires_at = min(idle, _aware(session.max_expires_at))
    else:
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


def revoke_user_sessions(
    db: Session, user_id: int, *, actor_id: int, keep_hash: str | None = None
) -> int:
    """Revoga as sessões ainda não revogadas do usuário, menos `keep_hash` (sem commit e sem
    auditar uma a uma: quem chama audita o total). Devolve quantas."""
    rows = db.scalars(
        select(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
    ).all()
    count = 0
    for session in rows:
        if keep_hash is not None and session.token_hash == keep_hash:
            continue
        revoke_session(db, session, actor_id=actor_id, audit=False)
        count += 1
    return count


# --- usuários e PIN ------------------------------------------------------------------------


def change_pin(db: Session, user: User, new_pin: str, *, actor_id: int | None) -> None:
    """Troca/reseta o PIN, destrava a conta e audita (sem gravar PIN nem hash)."""
    if not is_valid_pin(new_pin):
        raise ValueError(f"O PIN deve ter {PIN_LENGTH} dígitos.")
    if is_weak_pin(new_pin):
        raise ValueError(WEAK_PIN_MESSAGE)
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
