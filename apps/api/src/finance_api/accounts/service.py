"""Regras de conta: saldo calculado na consulta (nunca gravado).

Saldo atual = initial_balance_cents + lançamentos confirmados com date >= initial_balance_date:
  + receitas da conta, − despesas da conta,
  − transferências em que a conta é a origem, + transferências em que ela é o destino.

Cartão de crédito usa a mesma fórmula: compra (despesa) deixa o saldo mais negativo (= fatura
maior); pagamento de fatura é transferência conta → cartão (a conta cai, o cartão sobe).
"""

from collections.abc import Iterable
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from finance_api.accounts.schemas import AccountOut
from finance_api.db.models import Account, Transaction


def compute_balances(db: Session, account_ids: Iterable[int] | None = None) -> dict[int, int]:
    """Saldo atual (centavos) por id de conta. Contas sem lançamentos retornam o saldo inicial.

    `account_ids=None` calcula para todas as contas.
    """
    ids = None if account_ids is None else list(account_ids)
    acc_stmt = select(Account.id, Account.initial_balance_cents)
    if ids is not None:
        if not ids:
            return {}
        acc_stmt = acc_stmt.where(Account.id.in_(ids))
    balances: dict[int, int] = {row.id: row.initial_balance_cents for row in db.execute(acc_stmt)}

    # Perna da conta de origem/dona: receita (+), despesa (−), transferência saindo (−).
    signed = case(
        (Transaction.kind == "income", Transaction.amount_cents),
        else_=-Transaction.amount_cents,
    )
    own_stmt = (
        select(Transaction.account_id, func.coalesce(func.sum(signed), 0))
        .join(Account, Account.id == Transaction.account_id)
        .where(Transaction.status == "confirmed", Transaction.date >= Account.initial_balance_date)
        .group_by(Transaction.account_id)
    )
    if ids is not None:
        own_stmt = own_stmt.where(Transaction.account_id.in_(ids))
    for account_id, total in db.execute(own_stmt):
        balances[account_id] += int(total)

    # Perna de destino das transferências (+).
    in_stmt = (
        select(Transaction.to_account_id, func.coalesce(func.sum(Transaction.amount_cents), 0))
        .join(Account, Account.id == Transaction.to_account_id)
        .where(
            Transaction.status == "confirmed",
            Transaction.kind == "transfer",
            Transaction.date >= Account.initial_balance_date,
        )
        .group_by(Transaction.to_account_id)
    )
    if ids is not None:
        in_stmt = in_stmt.where(Transaction.to_account_id.in_(ids))
    for account_id, total in db.execute(in_stmt):
        balances[account_id] += int(total)
    return balances


def to_out(account: Account, balance_cents: int) -> AccountOut:
    return AccountOut(
        id=account.id,
        owner=account.owner,
        created_by=account.created_by,
        name=account.name,
        type=account.type,
        institution=account.institution,
        last4=account.last4,
        initial_balance_cents=account.initial_balance_cents,
        initial_balance_date=account.initial_balance_date,
        closing_day=account.closing_day,
        due_day=account.due_day,
        active=account.active,
        current_balance_cents=balance_cents,
    )


def audit_snapshot(account: Account) -> dict[str, Any]:
    """Estado gravável da conta (sem saldo calculado) para o log de auditoria."""
    return {
        "owner": str(account.owner),
        "name": account.name,
        "type": account.type,
        "institution": account.institution,
        "last4": account.last4,
        "initial_balance_cents": account.initial_balance_cents,
        "initial_balance_date": account.initial_balance_date.isoformat(),
        "closing_day": account.closing_day,
        "due_day": account.due_day,
        "active": account.active,
    }
