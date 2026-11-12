"""Regras de lançamentos: validação, cartão de crédito, duplicidade e auditoria.

As funções não fazem commit; quem chama (router, ou U5 na confirmação de rascunhos) confirma.
"""

import datetime as dt
from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from finance_api.core.audit import record_audit
from finance_api.core.permissions import CurrentUser, Owner, ensure_can_write
from finance_api.db.models import Account, Category, Transaction
from finance_api.transactions.dedupe import compute_dedupe_hash, find_possible_duplicates

# ASCII de propósito: vai num cabeçalho HTTP, que não é seguro para acentos.
PLAN_RULE_WARNING = (
    "Regra do plano: gasto no cartao fora das recorrencias cadastradas "
    "(categoria sem permissao para cartao)."
)


@dataclass
class TxData:
    """Campos gravados de um lançamento, já combinados (criação ou edição)."""

    kind: str
    amount_cents: int
    date: dt.date
    description: str
    account_id: int
    to_account_id: int | None
    category_id: int | None
    owner: str


@dataclass
class TxResult:
    transaction: Transaction
    possible_duplicates: list[Transaction] = field(default_factory=list)
    plan_rule_warning: str | None = None


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(422, detail)


def snapshot(tx: Transaction) -> dict[str, Any]:
    """Estado do lançamento para auditoria (datas ISO, dinheiro em centavos)."""
    return {
        "kind": tx.kind,
        "amount_cents": tx.amount_cents,
        "date": tx.date.isoformat(),
        "description": tx.description,
        "account_id": tx.account_id,
        "to_account_id": tx.to_account_id,
        "category_id": tx.category_id,
        "owner": str(tx.owner),
        "source": tx.source,
        "bill_instance_id": tx.bill_instance_id,
    }


def data_of(tx: Transaction) -> TxData:
    return TxData(
        kind=tx.kind,
        amount_cents=tx.amount_cents,
        date=tx.date,
        description=tx.description,
        account_id=tx.account_id,
        to_account_id=tx.to_account_id,
        category_id=tx.category_id,
        owner=str(tx.owner),
    )


def validate(db: Session, data: TxData) -> tuple[Account, Category | None]:
    """Valida contas/categoria/tipo; ajusta `data` (descrição sem espaços sobrando).

    Devolve a conta de origem e a categoria (se houver) para as regras de cartão.
    """
    data.description = data.description.strip()
    if not data.description:
        raise _unprocessable("A descrição é obrigatória.")
    account = db.get(Account, data.account_id)
    if account is None:
        raise _unprocessable("Conta não encontrada.")

    if data.kind == "transfer":
        if data.to_account_id is None:
            raise _unprocessable("Transferência exige a conta de destino.")
        if data.to_account_id == data.account_id:
            raise _unprocessable("Origem e destino da transferência devem ser contas diferentes.")
        if db.get(Account, data.to_account_id) is None:
            raise _unprocessable("Conta de destino não encontrada.")
        data.category_id = None  # transferência não é receita nem despesa
    elif data.to_account_id is not None:
        raise _unprocessable("Só transferências têm conta de destino.")

    category = None
    if data.category_id is not None:
        category = db.get(Category, data.category_id)
        if category is None:
            raise _unprocessable("Categoria não encontrada.")
    return account, category


def ensure_can_move(user: CurrentUser, account: Account) -> None:
    """Mexer no saldo de uma conta (origem do lançamento) exige poder escrever nela (D6).

    Receber numa conta (destino de transferência) não exige: só aumenta o saldo dela.
    """
    ensure_can_write(user, Owner(account.owner))


def plan_rule_warning(data: TxData, account: Account, category: Category | None) -> str | None:
    """Alerta (nunca bloqueio): despesa no cartão em categoria sem `is_recurring_card_allowed`."""
    if data.kind != "expense" or account.type != "credit_card":
        return None
    if category is not None and category.is_recurring_card_allowed:
        return None
    return PLAN_RULE_WARNING


def _apply(tx: Transaction, data: TxData) -> None:
    tx.kind = data.kind
    tx.amount_cents = data.amount_cents
    tx.date = data.date
    tx.description = data.description
    tx.account_id = data.account_id
    tx.to_account_id = data.to_account_id
    tx.category_id = data.category_id
    tx.owner = data.owner
    tx.dedupe_hash = compute_dedupe_hash(data.account_id, data.amount_cents, data.description)


def create_transaction(
    db: Session,
    user: CurrentUser,
    data: TxData,
    *,
    source: str = "manual",
    attachment_id: int | None = None,
    ai_extraction_id: int | None = None,
    bill_instance_id: int | None = None,
) -> TxResult:
    """Valida, checa permissão (dono do registro), grava e audita. Não bloqueia duplicatas."""
    ensure_can_write(user, Owner(data.owner))
    account, category = validate(db, data)
    ensure_can_move(user, account)
    duplicates = find_possible_duplicates(
        db,
        account_id=data.account_id,
        amount_cents=data.amount_cents,
        description=data.description,
        on_date=data.date,
    )
    tx = Transaction(
        created_by=user.id,
        status="confirmed",
        source=source,
        attachment_id=attachment_id,
        ai_extraction_id=ai_extraction_id,
        bill_instance_id=bill_instance_id,
    )
    _apply(tx, data)
    db.add(tx)
    db.flush()
    record_audit(
        db,
        user_id=user.id,
        entity="transactions",
        entity_id=tx.id,
        action="create",
        after=snapshot(tx),
    )
    return TxResult(tx, duplicates, plan_rule_warning(data, account, category))


def update_transaction(
    db: Session, user: CurrentUser, tx: Transaction, changes: dict[str, Any]
) -> TxResult:
    """Aplica as mudanças enviadas (campos ausentes ficam como estão)."""
    ensure_can_write(user, Owner(tx.owner))
    old_account = db.get(Account, tx.account_id)
    if old_account is not None:
        ensure_can_move(user, old_account)
    data = data_of(tx)
    for name, value in changes.items():
        setattr(data, name, value.value if name == "owner" else value)
    ensure_can_write(user, Owner(data.owner))  # nem "doar" o registro a outro dono
    if "to_account_id" not in changes and data.kind != "transfer":
        data.to_account_id = None  # trocou transferência por receita/despesa
    account, category = validate(db, data)
    ensure_can_move(user, account)

    before = snapshot(tx)
    _apply(tx, data)
    db.flush()
    record_audit(
        db,
        user_id=user.id,
        entity="transactions",
        entity_id=tx.id,
        action="update",
        before=before,
        after=snapshot(tx),
    )
    duplicates = find_possible_duplicates(
        db,
        account_id=data.account_id,
        amount_cents=data.amount_cents,
        description=data.description,
        on_date=data.date,
        exclude_id=tx.id,
    )
    return TxResult(tx, duplicates, plan_rule_warning(data, account, category))
