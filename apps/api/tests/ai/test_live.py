"""Teste opcional contra a API real (`./tasks.ps1 ai-live`). Gasta crédito.

Pulado sem `OPENAI_API_KEY`/`OPENAI_MODEL`. Só documentos sintéticos (dados fictícios):
comprovante (imagem gerada), extrato curto (PDF digital da pasta de fixtures) e texto livre.
"""

import datetime as dt
import io
import os
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

from finance_api.ai.client import OpenAIClient
from finance_api.ai.context import RULES, AccountRef, AiContext, CategoryRef
from finance_api.attachments.prepare import prepare
from finance_api.attachments.storage import PDF, PNG
from finance_api.core.config import Settings

pytestmark = pytest.mark.live

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "ai"


def _client() -> OpenAIClient:
    settings = Settings()
    if not (os.environ.get("OPENAI_API_KEY") or settings.openai_api_key):
        pytest.skip("Sem OPENAI_API_KEY.")
    if not settings.openai_model:
        pytest.skip("Sem OPENAI_MODEL.")
    return OpenAIClient(settings)


def _context() -> AiContext:
    return AiContext(
        today=dt.date(2026, 11, 12),
        sender="Ruth",
        accounts=[
            AccountRef(name="Nubank Ruth", type="checking", owner="RUTH", last4="4321"),
            AccountRef(name="Sonia", type="checking", owner="MATHEUS", last4=None),
            AccountRef(name="Matheus", type="checking", owner="MATHEUS", last4=None),
            AccountRef(name="Dinheiro", type="cash", owner="AMBOS", last4=None),
        ],
        categories=[
            CategoryRef(name="Mercado", kind="expense"),
            CategoryRef(name="Farmácia", kind="expense"),
            CategoryRef(name="Salário", kind="income"),
        ],
        rules=list(RULES),
    )


def _receipt_png() -> bytes:
    image = Image.new("RGB", (600, 400), "white")
    draw = ImageDraw.Draw(image)
    lines = [
        "SUPERMERCADO EXEMPLO LTDA",
        "CUPOM FISCAL (FICTICIO)",
        "10/11/2026 18:42",
        "ARROZ 5KG ........ 25,90",
        "FEIJAO 1KG ....... 9,00",
        "TOTAL R$ 34,90",
        "PAGO NO DEBITO - CARTAO FINAL 4321",
    ]
    for i, line in enumerate(lines):
        draw.text((30, 30 + i * 45), line, fill="black")
    out = io.BytesIO()
    image.save(out, "PNG")
    return out.getvalue()


def test_live_receipt_image() -> None:
    prepared = prepare(_receipt_png(), PNG)
    call = _client().extract(context=_context(), text=None, images=prepared.images)
    assert call.result.document_type in ("receipt", "other")
    assert call.usage_tokens


def test_live_short_statement_pdf() -> None:
    prepared = prepare((FIXTURES / "extrato_digital.pdf").read_bytes(), PDF)
    call = _client().extract(context=_context(), text=prepared.text, images=[])
    assert call.result.document_type == "statement"
    assert {t.amount_cents for t in call.result.transactions} >= {3290, 1250}


def test_live_free_text() -> None:
    call = _client().extract(
        context=_context(), text="gastei 32,50 na farmácia no dinheiro hoje", images=[]
    )
    (tx,) = call.result.transactions
    assert tx.kind == "expense"
    assert tx.amount_cents == 3250
    assert tx.date == dt.date(2026, 11, 12)
    # A API devolve o uso separado (entrada/saída), base do custo estimado no painel admin.
    from finance_api.ai.pricing import estimate_cost_cents

    assert call.input_tokens and call.output_tokens
    assert estimate_cost_cents(call.model, call.input_tokens, call.output_tokens) is not None
