"""Lançamentos (docs/api/openapi.yaml).

Sinais que o contrato não prevê no corpo de `Transaction` vão em cabeçalhos da resposta de
POST/PATCH (a criação nunca é bloqueada):
- `X-Possible-Duplicate-Of`: ids (separados por vírgula) de lançamentos que parecem o mesmo;
- `X-Plan-Rule-Warning`: texto do aviso "regra do plano" (despesa no cartão fora das recorrências).
"""

import csv
import datetime as dt
import io
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import Select, func, or_, select

from finance_api.core.audit import record_audit
from finance_api.core.deps import DbSession, get_current_user
from finance_api.core.permissions import CurrentUser, Owner, ensure_can_write
from finance_api.db.models import Account, Category, Transaction
from finance_api.transactions.schemas import (
    TransactionCreate,
    TransactionOut,
    TransactionPage,
    TransactionUpdate,
    TxKind,
)
from finance_api.transactions.service import (
    TxData,
    TxResult,
    create_transaction,
    ensure_can_move,
    snapshot,
    update_transaction,
)

router = APIRouter(tags=["transactions"])

User = Annotated[CurrentUser, Depends(get_current_user)]

DUPLICATE_HEADER = "X-Possible-Duplicate-Of"
WARNING_HEADER = "X-Plan-Rule-Warning"

_KIND_LABEL = {"income": "Receita", "expense": "Despesa", "transfer": "Transferência"}
_CSV_HEADER = [
    "Data",
    "Tipo",
    "Descrição",
    "Valor (R$)",
    "Conta",
    "Conta destino",
    "Categoria",
    "Dono",
    "Origem",
]


@dataclass
class Filters:
    owner: Owner | None = None
    account_id: int | None = None
    category_id: int | None = None
    kind: str | None = None
    date_from: dt.date | None = None
    date_to: dt.date | None = None
    q: str | None = None


def filters(
    owner: Owner | None = None,
    account_id: int | None = None,
    category_id: int | None = None,
    kind: TxKind | None = None,
    date_from: dt.date | None = None,
    date_to: dt.date | None = None,
    q: str | None = None,
) -> Filters:
    return Filters(owner, account_id, category_id, kind, date_from, date_to, q)


FilterDep = Annotated[Filters, Depends(filters)]


def _apply_filters(stmt: Select, f: Filters) -> Select:
    if f.owner is not None:
        stmt = stmt.where(Transaction.owner == f.owner.value)
    if f.account_id is not None:  # extrato da conta: inclui transferências recebidas
        stmt = stmt.where(
            or_(Transaction.account_id == f.account_id, Transaction.to_account_id == f.account_id)
        )
    if f.category_id is not None:
        stmt = stmt.where(Transaction.category_id == f.category_id)
    if f.kind is not None:
        stmt = stmt.where(Transaction.kind == f.kind)
    if f.date_from is not None:
        stmt = stmt.where(Transaction.date >= f.date_from)
    if f.date_to is not None:
        stmt = stmt.where(Transaction.date <= f.date_to)
    if f.q and f.q.strip():
        pattern = "%" + f.q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        stmt = stmt.where(Transaction.description.ilike(pattern + "%", escape="\\"))
    return stmt


def _ordered(stmt: Select) -> Select:
    return stmt.order_by(Transaction.date.desc(), Transaction.id.desc())


def _get_or_404(db: DbSession, tx_id: int) -> Transaction:
    tx = db.get(Transaction, tx_id)
    if tx is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lançamento não encontrado.")
    return tx


def _signal(response: Response, result: TxResult) -> None:
    if result.possible_duplicates:
        response.headers[DUPLICATE_HEADER] = ",".join(str(t.id) for t in result.possible_duplicates)
    if result.plan_rule_warning:
        response.headers[WARNING_HEADER] = result.plan_rule_warning


@router.get("/transactions", response_model=TransactionPage)
def list_transactions(
    db: DbSession,
    _user: User,
    f: FilterDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> TransactionPage:
    total = db.scalar(_apply_filters(select(func.count(Transaction.id)), f)) or 0
    rows = db.scalars(_ordered(_apply_filters(select(Transaction), f)).limit(limit).offset(offset))
    return TransactionPage(items=[TransactionOut.model_validate(t) for t in rows], total=total)


def _csv_text(value: str) -> str:
    """Evita injeção de fórmula ao abrir no Excel (valores que começam com = + - @)."""
    risky = value[:1] in ("\t", "\r") or value.lstrip()[:1] in ("=", "+", "-", "@", "|", "%")
    return "'" + value if risky else value


def _reais(cents: int) -> str:
    return f"{cents // 100},{cents % 100:02d}"


@router.get("/transactions/export.csv")
def export_transactions_csv(
    db: DbSession,
    _user: User,
    f: FilterDep,
    limit: Annotated[int | None, Query(ge=1, le=200)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Response:
    """CSV para Excel BR: UTF-8 com BOM, `;`, vírgula decimal e datas dd/mm/aaaa.

    Sem `limit`, exporta tudo o que casa com os filtros.
    """
    stmt = _ordered(_apply_filters(select(Transaction), f)).offset(offset)
    if limit is not None:
        stmt = stmt.limit(limit)
    rows = list(db.scalars(stmt))
    account_names = {row.id: row.name for row in db.execute(select(Account.id, Account.name))}
    category_names = {row.id: row.name for row in db.execute(select(Category.id, Category.name))}

    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", lineterminator="\r\n")
    writer.writerow(_CSV_HEADER)
    for t in rows:
        writer.writerow(
            [
                t.date.strftime("%d/%m/%Y"),
                _KIND_LABEL[t.kind],
                _csv_text(t.description),
                _reais(t.amount_cents),
                _csv_text(account_names.get(t.account_id, "")),
                _csv_text(account_names.get(t.to_account_id, "")) if t.to_account_id else "",
                _csv_text(category_names.get(t.category_id, "")) if t.category_id else "",
                t.owner,
                t.source,
            ]
        )
    return Response(
        content=("﻿" + buffer.getvalue()).encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="lancamentos.csv"'},
    )


@router.post("/transactions", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def create_transaction_endpoint(
    body: TransactionCreate, response: Response, db: DbSession, user: User
) -> TransactionOut:
    result = create_transaction(
        db,
        user,
        TxData(
            kind=body.kind,
            amount_cents=body.amount_cents,
            date=body.date,
            description=body.description,
            account_id=body.account_id,
            to_account_id=body.to_account_id,
            category_id=body.category_id,
            owner=body.owner.value,
        ),
        source="manual",
    )
    db.commit()
    _signal(response, result)
    return TransactionOut.model_validate(result.transaction)


@router.get("/transactions/{tx_id}", response_model=TransactionOut)
def get_transaction(tx_id: int, db: DbSession, _user: User) -> TransactionOut:
    return TransactionOut.model_validate(_get_or_404(db, tx_id))


@router.patch("/transactions/{tx_id}", response_model=TransactionOut)
def update_transaction_endpoint(
    tx_id: int, body: TransactionUpdate, response: Response, db: DbSession, user: User
) -> TransactionOut:
    tx = _get_or_404(db, tx_id)
    ensure_can_write(user, Owner(tx.owner))  # 403 antes de validar o corpo
    changes = {name: getattr(body, name) for name in body.model_fields_set}
    for name in set(changes) - {"to_account_id", "category_id"}:
        if changes[name] is None:
            raise HTTPException(422, f"'{name}' não pode ser nulo.")
    result = update_transaction(db, user, tx, changes)
    db.commit()
    _signal(response, result)
    return TransactionOut.model_validate(result.transaction)


@router.delete("/transactions/{tx_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(tx_id: int, db: DbSession, user: User) -> Response:
    tx = _get_or_404(db, tx_id)
    ensure_can_write(user, Owner(tx.owner))
    account = db.get(Account, tx.account_id)
    if account is not None:
        ensure_can_move(user, account)
    before = snapshot(tx)
    db.delete(tx)
    record_audit(
        db,
        user_id=user.id,
        entity="transactions",
        entity_id=tx.id,
        action="delete",
        before=before,
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
