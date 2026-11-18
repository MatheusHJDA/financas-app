from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from finance_api.core.config import get_settings


@lru_cache
def get_engine() -> Engine:
    """Engine criado sob demanda (não conecta até o primeiro uso)."""
    return create_engine(get_settings().database_url, pool_pre_ping=True)


@lru_cache
def get_sessionmaker() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


# Abre uma sessão de banco própria (`with factory() as db:`), para trabalho fora do pedido.
SessionFactory = Callable[[], AbstractContextManager[Session]]


def get_session_factory() -> SessionFactory:
    """Dependência: tarefas de fundo abrem a própria sessão (a do pedido já fechou)."""
    return get_sessionmaker()


def get_db() -> Iterator[Session]:
    db = get_sessionmaker()()
    try:
        yield db
    finally:
        db.close()
