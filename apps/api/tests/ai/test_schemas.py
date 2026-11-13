"""`ExtractionResult`: exatamente o JSON da seção 6.2; dinheiro inteiro; nada de campo extra."""

import json
from pathlib import Path

import pytest
from openai.lib._parsing._responses import type_to_text_format_param
from pydantic import ValidationError

from finance_api.ai.schemas import PROMPT_VERSION, ExtractionResult

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "ai"


def _tx(**changes) -> dict:
    tx = {
        "kind": "expense",
        "amount_cents": 4590,
        "date": "2026-11-12",
        "description": "Supermercado BH",
        "account_hint": "Nubank Ruth",
        "to_account_hint": None,
        "category_hint": "Mercado",
        "owner_hint": "RUTH",
        "is_credit_card": False,
        "confidence": 0.9,
        "notes": "cupom fiscal",
    }
    tx.update(changes)
    return tx


def _doc(*txs: dict, **changes) -> str:
    doc = {"transactions": list(txs), "document_type": "receipt", "warnings": []}
    doc.update(changes)
    return json.dumps(doc)


def test_valid_document_parses() -> None:
    result = ExtractionResult.model_validate_json(_doc(_tx()))
    assert result.transactions[0].amount_cents == 4590
    assert result.document_type == "receipt"
    assert PROMPT_VERSION


@pytest.mark.parametrize("amount", [45.9, 45.0, "4590", 0, -100])
def test_amount_must_be_positive_integer_cents(amount) -> None:
    with pytest.raises(ValidationError):
        ExtractionResult.model_validate_json(_doc(_tx(amount_cents=amount)))


def test_extra_field_is_rejected() -> None:
    with pytest.raises(ValidationError):
        ExtractionResult.model_validate_json(_doc(_tx(balance_cents=100)))
    with pytest.raises(ValidationError):
        ExtractionResult.model_validate_json(_doc(_tx(), extra="x"))


@pytest.mark.parametrize(
    "changes",
    [
        {"confidence": 1.5},
        {"confidence": -0.1},
        {"kind": "payment"},
        {"owner_hint": "SONIA"},
        {"date": "12/11/2026"},
    ],
)
def test_invalid_values_are_rejected(changes) -> None:
    with pytest.raises(ValidationError):
        ExtractionResult.model_validate_json(_doc(_tx(**changes)))


def test_missing_nullable_field_is_rejected() -> None:
    tx = _tx()
    del tx["to_account_hint"]
    with pytest.raises(ValidationError):
        ExtractionResult.model_validate_json(_doc(tx))


def test_document_type_is_closed_list() -> None:
    for kind in ("receipt", "statement", "invoice", "free_text", "other"):
        ExtractionResult.model_validate_json(_doc(document_type=kind))
    with pytest.raises(ValidationError):
        ExtractionResult.model_validate_json(_doc(document_type="boleto"))


def test_schema_is_accepted_as_strict_structured_output() -> None:
    fmt = type_to_text_format_param(ExtractionResult)
    assert fmt["type"] == "json_schema"
    assert fmt["strict"] is True
    schema = fmt["schema"]
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == {"transactions", "document_type", "warnings"}
    tx_schema = schema["$defs"]["ExtractedTransaction"]
    assert tx_schema["additionalProperties"] is False
    assert set(tx_schema["required"]) == set(tx_schema["properties"])
    assert tx_schema["properties"]["amount_cents"]["type"] == "integer"


def test_all_recorded_fixtures_are_valid() -> None:
    files = sorted(FIXTURES.glob("*.json"))
    assert len(files) >= 6
    kinds = set()
    for path in files:
        data = json.loads(path.read_text(encoding="utf-8"))
        kinds.add(ExtractionResult.model_validate(data["output"]).document_type)
    assert kinds == {"receipt", "statement", "invoice", "free_text", "other"}
