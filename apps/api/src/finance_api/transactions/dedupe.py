"""Detecção de duplicidade de lançamentos (reutilizada por U5 na ingestão).

dedupe_hash = sha256 de (conta, valor em centavos, descrição normalizada); a data fica fora do
hash porque a regra é "mesmo hash com data ±1 dia" (ORQUESTRACAO.md 6.2).
"""

import hashlib
import re
import unicodedata
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from finance_api.db.models import Transaction

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def normalize_description(description: str) -> str:
    """Minúsculas, sem acentos nem pontuação, espaços colapsados."""
    decomposed = unicodedata.normalize("NFKD", description)
    ascii_only = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return _NON_ALNUM.sub(" ", ascii_only.lower()).strip()


def compute_dedupe_hash(account_id: int, amount_cents: int, description: str) -> str:
    key = f"{account_id}|{amount_cents}|{normalize_description(description)}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def find_possible_duplicates(
    db: Session,
    *,
    account_id: int,
    amount_cents: int,
    description: str,
    on_date: date,
    exclude_id: int | None = None,
) -> list[Transaction]:
    """Lançamentos já gravados com o mesmo (conta, valor, descrição) e data a no máximo 1 dia.

    Só consulta; nunca bloqueia nada. `exclude_id` ignora o próprio lançamento (edição).
    """
    stmt = select(Transaction).where(
        Transaction.dedupe_hash == compute_dedupe_hash(account_id, amount_cents, description),
        Transaction.date >= on_date - timedelta(days=1),
        Transaction.date <= on_date + timedelta(days=1),
    )
    if exclude_id is not None:
        stmt = stmt.where(Transaction.id != exclude_id)
    return list(db.scalars(stmt.order_by(Transaction.date, Transaction.id)))
