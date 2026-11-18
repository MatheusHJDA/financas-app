"""Limites de tentativas de login: por origem (IP) e por conta (trava sem prazo).

- Origem: 5 falhas em 15 min bloqueiam aquela origem até a mais antiga sair da janela.
- Início da entrada em duas etapas: 20 por origem em 15 min, certos ou errados.
- Conta: 20 falhas em 1 h travam a conta (`users.locked_at`) até a administração liberar.

O relógio vem de quem chama (`now`), para os testes simularem o tempo. Nada aqui faz commit.
"""

from datetime import datetime, timedelta

from fastapi import Request
from sqlalchemy import func, select, text, update
from sqlalchemy.orm import Session

from finance_api.core.audit import record_audit
from finance_api.db.models import AuthFailure, User

SOURCE_MAX_FAILURES = 5
SOURCE_WINDOW = timedelta(minutes=15)
# Inícios da entrada em duas etapas por origem na janela, contados com PIN certo ou errado
# (o 429 não revela nada); evita que uma origem deixe o argon2 rodando sem parar.
SOURCE_MAX_STARTS = 20
ACCOUNT_MAX_FAILURES = 20
ACCOUNT_WINDOW = timedelta(hours=1)

_SOURCE_MAX_LENGTH = 64
# Primeira chave das travas consultivas por origem (separa de outros usos de pg_advisory_lock).
SOURCE_LOCK_NAMESPACE = 0x4C47  # "LG"


def request_source(request: Request) -> str:
    """IP de quem conecta. Atrás do Caddy, o uvicorn (`--proxy-headers`) já o troca pelo real."""
    if request.client is None or not request.client.host:
        return "desconhecida"
    return request.client.host[:_SOURCE_MAX_LENGTH]


def lock_source(db: Session, source: str) -> None:
    """Serializa as tentativas da mesma origem até o fim da transação (commit ou rollback).

    Sem isso, pedidos paralelos leem "menos de 5 falhas" juntos e todos testam um PIN.
    """
    db.execute(
        text("SELECT pg_advisory_xact_lock(:ns, hashtext(:source))"),
        {"ns": SOURCE_LOCK_NAMESPACE, "source": source[:_SOURCE_MAX_LENGTH]},
    )


def source_retry_after(db: Session, source: str, now: datetime) -> int | None:
    """Segundos até a origem sair do bloqueio, ou `None` se ela pode tentar."""
    recent = db.scalars(
        select(AuthFailure.at)
        .where(AuthFailure.source == source, AuthFailure.at > now - SOURCE_WINDOW)
        .order_by(AuthFailure.at.desc())
        .limit(SOURCE_MAX_FAILURES)
    ).all()
    if len(recent) < SOURCE_MAX_FAILURES:
        return None
    # Libera quando a mais antiga das últimas 5 sair da janela.
    release_at = recent[-1] + SOURCE_WINDOW
    return max(1, int((release_at - now).total_seconds()))


def is_locked(user: User) -> bool:
    return user.locked_at is not None


def account_failures(db: Session, user_id: int, now: datetime) -> int:
    """Falhas da conta na janela de 1 h."""
    count = db.scalar(
        select(func.count())
        .select_from(AuthFailure)
        .where(AuthFailure.user_id == user_id, AuthFailure.at > now - ACCOUNT_WINDOW)
    )
    return count or 0


def record_failure(db: Session, *, source: str, user: User | None, now: datetime) -> None:
    """Grava a falha; atualiza a contagem da conta e a trava ao chegar a 20 na janela."""
    db.add(
        AuthFailure(source=source[:_SOURCE_MAX_LENGTH], user_id=user.id if user else None, at=now)
    )
    db.flush()
    if user is None:
        return
    user.failed_attempts = account_failures(db, user.id, now)
    if user.failed_attempts >= ACCOUNT_MAX_FAILURES and not is_locked(user):
        user.locked_at = now
        record_audit(
            db,
            user_id=None,
            entity="users",
            entity_id=user.id,
            action="update",
            before={"locked": False},
            after={"locked": True},
        )


def release_account(db: Session, user: User) -> None:
    """Destrava a conta e zera a contagem dela (as falhas continuam valendo para a origem)."""
    user.locked_at = None
    user.failed_attempts = 0
    db.execute(update(AuthFailure).where(AuthFailure.user_id == user.id).values(user_id=None))
