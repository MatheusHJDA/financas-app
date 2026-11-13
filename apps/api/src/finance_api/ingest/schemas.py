"""Schemas da ingestão (openapi.yaml: ProposedTransaction, Draft, IngestResult, AiError)."""

import datetime as dt
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StrictInt

from finance_api.core.permissions import Owner
from finance_api.transactions.schemas import Description, PositiveCents, TxKind

DraftStatus = Literal["pending", "confirmed", "discarded"]
AiErrorCode = Literal["ai_limit_reached", "ai_unavailable"]


class ProposedTransaction(BaseModel):
    kind: TxKind
    amount_cents: PositiveCents
    date: dt.date
    description: Description
    account_id: StrictInt | None = None
    to_account_id: StrictInt | None = None
    category_id: StrictInt | None = None
    owner: Owner | None = None


class DraftOut(BaseModel):
    id: int
    status: DraftStatus
    payload: ProposedTransaction
    confidence: Annotated[float, Field(ge=0, le=1)]
    low_confidence_fields: list[str]
    duplicate_of_transaction_id: int | None = None
    plan_rule_warning: str | None = None
    suggested_bill_instance_id: int | None = None


class IngestResult(BaseModel):
    extraction_id: int
    document_type: str
    warnings: list[str]
    drafts: list[DraftOut]


class AiErrorOut(BaseModel):
    detail: str
    code: AiErrorCode


class ConfirmBatch(BaseModel):
    draft_ids: Annotated[list[StrictInt], Field(min_length=1, max_length=200)]
