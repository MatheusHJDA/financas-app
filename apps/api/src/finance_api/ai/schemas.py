"""Saída estruturada da IA (ORQUESTRACAO.md 6.2): `ExtractionResult`.

O mesmo schema vai para a OpenAI (saída estruturada estrita) e valida a resposta. Por isso:
- todo campo é obrigatório (os opcionais são `X | None` sem valor padrão);
- `extra="forbid"` (vira `additionalProperties: false`);
- só restrições aceitas pela saída estruturada (`exclusiveMinimum`, `minimum`, `maximum`).

Dinheiro sempre em centavos inteiros: `amount_cents` é `StrictInt` (45.9 ou 45.0 → erro).
"""

import datetime as dt
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt

# Mude quando o prompt ou o schema mudarem (fica gravado em `ai_extractions.prompt_version`).
PROMPT_VERSION = "u5-2026-11-12.1"

TxKind = Literal["income", "expense", "transfer"]
OwnerHint = Literal["RUTH", "MATHEUS", "AMBOS"]
DocumentType = Literal["receipt", "statement", "invoice", "free_text", "other"]


class ExtractedTransaction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: TxKind
    amount_cents: Annotated[StrictInt, Field(gt=0)]
    date: dt.date
    description: str
    account_hint: str | None
    to_account_hint: str | None
    category_hint: str | None
    owner_hint: OwnerHint | None
    is_credit_card: bool
    confidence: Annotated[float, Field(ge=0, le=1)]
    notes: str | None


class ExtractionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    transactions: list[ExtractedTransaction]
    document_type: DocumentType
    warnings: list[str]
