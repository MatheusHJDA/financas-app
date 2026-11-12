"""Schemas de lançamentos (docs/api/openapi.yaml: Transaction*)."""

import datetime as dt
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt

from finance_api.core.permissions import Owner

TxKind = Literal["income", "expense", "transfer"]
TxSource = Literal["chat", "manual", "import"]

# Dinheiro: inteiro em centavos, sempre positivo (o sinal vem do `kind`).
PositiveCents = Annotated[StrictInt, Field(ge=1, le=10**14)]
Description = Annotated[str, Field(min_length=1, max_length=500)]


class TransactionCreate(BaseModel):
    kind: TxKind
    amount_cents: PositiveCents
    date: dt.date
    description: Description
    account_id: StrictInt
    to_account_id: StrictInt | None = None
    category_id: StrictInt | None = None
    owner: Owner


class TransactionUpdate(BaseModel):
    kind: TxKind | None = None
    amount_cents: PositiveCents | None = None
    date: dt.date | None = None
    description: Description | None = None
    account_id: StrictInt | None = None
    to_account_id: StrictInt | None = None
    category_id: StrictInt | None = None
    owner: Owner | None = None


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: TxKind
    amount_cents: int
    date: dt.date
    description: str
    account_id: int
    to_account_id: int | None
    category_id: int | None
    owner: Owner
    created_by: int
    status: Literal["confirmed"]
    source: TxSource
    attachment_id: int | None
    ai_extraction_id: int | None
    bill_instance_id: int | None
    created_at: dt.datetime
    updated_at: dt.datetime


class TransactionPage(BaseModel):
    items: list[TransactionOut]
    total: int
