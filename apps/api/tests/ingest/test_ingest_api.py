"""`POST /ingest` e `GET /ingest/{id}`: só rascunhos, nunca lançamento; falhas da IA gravadas."""

from pathlib import Path

import pytest
from attachments.samples import digital_pdf, image_bytes, scanned_pdf
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from finance_api.ai.client import AiInvalidOutput, AiLimitReached, AiUnavailable
from finance_api.ai.schemas import PROMPT_VERSION, ExtractionResult
from finance_api.core.config import Settings, get_settings
from finance_api.db.models import AiExtraction, Attachment, Draft
from finance_api.transactions.service import PLAN_RULE_WARNING

from .fakes import FIXTURE_NAMES, load_fixture

LIMIT_MESSAGE = "O limite mensal da IA foi atingido. Lance pelo formulário."


def _count(db: Session, model) -> int:
    return db.scalar(select(func.count()).select_from(model)) or 0


def test_fixtures_cover_the_five_document_types() -> None:
    kinds = {load_fixture(name)["output"]["document_type"] for name in FIXTURE_NAMES}
    assert kinds == {"receipt", "statement", "invoice", "free_text", "other"}
    assert "pix_sonia_matheus" in FIXTURE_NAMES


@pytest.mark.parametrize("fixture", FIXTURE_NAMES)
def test_ingest_never_creates_transactions(
    fixture: str, db: Session, users, world, use_ai, client_as, count_transactions
) -> None:
    use_ai(fixture)
    before = count_transactions()

    response = client_as(users["ruth"]).post("/api/ingest", data={"text": "mensagem de teste"})

    assert response.status_code == 200, response.text
    assert count_transactions() == before
    body = response.json()
    expected = load_fixture(fixture)["output"]
    assert body["document_type"] == expected["document_type"]
    assert len(body["drafts"]) == len(expected["transactions"])
    assert all(d["status"] == "pending" for d in body["drafts"])
    for warning in expected["warnings"]:
        assert warning in body["warnings"]

    extraction = db.get(AiExtraction, body["extraction_id"])
    assert extraction.status == "ok"
    assert extraction.prompt_version == PROMPT_VERSION
    assert extraction.model == "fixture-gravada"
    assert extraction.usage_tokens == load_fixture(fixture)["usage_tokens"]
    assert extraction.input_kind == "text"
    assert extraction.raw_output_json["output"] == expected
    assert extraction.user_id == users["ruth"].id


def test_pix_sonia_matheus_becomes_transfer_draft(db, users, world, use_ai, client_as) -> None:
    use_ai("pix_sonia_matheus")
    body = client_as(users["matheus"]).post("/api/ingest", data={"text": "comprovante"}).json()
    (draft,) = body["drafts"]
    assert draft["payload"]["kind"] == "transfer"
    assert draft["payload"]["account_id"] == world.sonia.id
    assert draft["payload"]["to_account_id"] == world.matheus.id
    assert draft["payload"]["category_id"] is None
    assert draft["payload"]["amount_cents"] == 150000


def test_invoice_drafts_have_card_and_plan_rule_warning(
    db, users, world, use_ai, client_as
) -> None:
    use_ai("fatura_cartao")
    body = client_as(users["ruth"]).post("/api/ingest", data={"text": "fatura"}).json()
    by_description = {d["payload"]["description"]: d for d in body["drafts"]}
    assert {d["payload"]["account_id"] for d in body["drafts"]} == {world.cartao_ruth.id}
    assert by_description["Streaming Exemplo"]["plan_rule_warning"] is None  # recorrente ok
    assert by_description["Loja Exemplo Centro"]["plan_rule_warning"] == PLAN_RULE_WARNING
    assert by_description["Delivery Exemplo"]["plan_rule_warning"] == PLAN_RULE_WARNING
    assert by_description["Loja Exemplo Centro"]["low_confidence_fields"] == ["category_id"]


def test_statement_draft_signals(db, users, world, use_ai, client_as) -> None:
    use_ai("extrato_varias_linhas")
    body = client_as(users["ruth"]).post("/api/ingest", data={"text": "extrato"}).json()
    pix = next(d for d in body["drafts"] if d["payload"]["kind"] == "income")
    assert pix["confidence"] == 0.55
    assert {"kind", "amount_cents", "date", "account_id", "category_id"} <= set(
        pix["low_confidence_fields"]
    )
    luz = next(d for d in body["drafts"] if d["payload"]["description"] == "Conta de luz CEMIG")
    assert luz["payload"]["owner"] == "AMBOS"
    assert luz["payload"]["category_id"] == world.categories["Luz"].id
    for draft in body["drafts"]:
        assert set(draft) >= {
            "duplicate_of_transaction_id",
            "plan_rule_warning",
            "suggested_bill_instance_id",
        }


def test_get_ingest_returns_same_result_for_sender_and_admin(
    db, users, world, use_ai, client_as
) -> None:
    use_ai("extrato_varias_linhas")
    posted = client_as(users["ruth"]).post("/api/ingest", data={"text": "extrato"}).json()
    url = f"/api/ingest/{posted['extraction_id']}"

    assert client_as(users["ruth"]).get(url).json() == posted
    assert client_as(users["matheus"]).get(url).status_code == 200  # admin


def test_get_ingest_of_other_user_is_404(db, users, world, use_ai, client_as) -> None:
    use_ai("comprovante_mercado")
    posted = client_as(users["matheus"]).post("/api/ingest", data={"text": "x"}).json()
    response = client_as(users["ruth"]).get(f"/api/ingest/{posted['extraction_id']}")
    assert response.status_code == 404
    assert client_as(users["ruth"]).get("/api/ingest/999999").status_code == 404


def test_ingest_requires_login(db, users, world, use_ai, client_as) -> None:
    use_ai("texto_livre")
    assert client_as(None).post("/api/ingest", data={"text": "x"}).status_code == 401


# --- Entrada ----------------------------------------------------------------------------------


def test_nothing_sent_is_422(db, users, world, use_ai, client_as) -> None:
    fake = use_ai("texto_livre")
    client = client_as(users["ruth"])
    assert client.post("/api/ingest").status_code == 422
    assert client.post("/api/ingest", data={"text": "   "}).status_code == 422
    assert fake.calls == []
    assert _count(db, AiExtraction) == 0


def test_text_too_long_is_422(db, users, world, use_ai, client_as) -> None:
    fake = use_ai("texto_livre")
    response = client_as(users["ruth"]).post("/api/ingest", data={"text": "a" * 20_001})
    assert response.status_code == 422
    assert fake.calls == []


def test_file_too_large_is_413_and_saves_nothing(
    db, users, world, use_ai, client_as, app, upload_dir: Path
) -> None:
    fake = use_ai("comprovante_mercado")
    small = Settings(_env_file=None, upload_dir=str(upload_dir), max_upload_bytes=1000)
    app.dependency_overrides[get_settings] = lambda: small

    big = image_bytes("PNG", size=(400, 400))
    assert len(big) > 1000
    response = client_as(users["ruth"]).post(
        "/api/ingest", files={"file": ("foto.png", big, "image/png")}
    )
    assert response.status_code == 413
    assert fake.calls == []
    assert _count(db, Attachment) == 0
    assert _count(db, AiExtraction) == 0
    assert list(upload_dir.rglob("*")) == []


def test_unknown_type_is_422_even_with_image_name(
    db, users, world, use_ai, client_as, upload_dir: Path
) -> None:
    fake = use_ai("comprovante_mercado")
    response = client_as(users["ruth"]).post(
        "/api/ingest", files={"file": ("foto.jpg", b"<html>nao sou imagem</html>", "image/jpeg")}
    )
    assert response.status_code == 422
    assert fake.calls == []
    assert list(upload_dir.rglob("*")) == []


def test_image_upload_is_saved_and_sent_reduced(
    db, users, world, use_ai, client_as, upload_dir: Path, count_transactions
) -> None:
    fake = use_ai("comprovante_mercado")
    data = image_bytes("PNG", size=(3000, 1500))
    client = client_as(users["ruth"])

    response = client.post(
        "/api/ingest",
        data={"text": "mercado de hoje"},
        files={"file": ("../../../etc/passwd.png", data, "image/png")},
    )

    assert response.status_code == 200, response.text
    assert count_transactions() == 0
    (received,) = fake.calls
    assert received.text == "mercado de hoje"
    assert len(received.images) == 1 and received.images[0][:3] == b"\xff\xd8\xff"
    extraction = db.get(AiExtraction, response.json()["extraction_id"])
    assert extraction.input_kind == "image"
    attachment = db.get(Attachment, extraction.attachment_id)
    assert attachment.mime == "image/png"
    assert "passwd" not in attachment.path
    assert (upload_dir / attachment.path).read_bytes() == data
    assert client.get(f"/api/attachments/{attachment.id}").content == data


def test_digital_pdf_sends_text(db, users, world, use_ai, client_as) -> None:
    fake = use_ai("extrato_varias_linhas")
    response = client_as(users["ruth"]).post(
        "/api/ingest", files={"file": ("extrato.pdf", digital_pdf(), "application/pdf")}
    )
    assert response.status_code == 200, response.text
    (received,) = fake.calls
    assert received.images == []
    assert "Farmacia Exemplo" in received.text
    extraction = db.get(AiExtraction, response.json()["extraction_id"])
    assert extraction.input_kind == "pdf_text"


def test_scanned_pdf_sends_page_images(db, users, world, use_ai, client_as) -> None:
    fake = use_ai("comprovante_mercado")
    response = client_as(users["ruth"]).post(
        "/api/ingest", files={"file": ("scan.pdf", scanned_pdf(pages=2), "application/pdf")}
    )
    assert response.status_code == 200, response.text
    (received,) = fake.calls
    assert len(received.images) == 2
    extraction = db.get(AiExtraction, response.json()["extraction_id"])
    assert extraction.input_kind == "pdf_scan"


def test_context_sent_to_ai_is_minimal(db, users, world, use_ai, client_as) -> None:
    fake = use_ai("texto_livre")
    client_as(users["ruth"]).post("/api/ingest", data={"text": "gastei 32,50"})
    (received,) = fake.calls
    assert received.context.sender == "Ruth"
    assert {a.name for a in received.context.accounts} >= {"Sonia", "Matheus", "Nubank Ruth"}


# --- Falhas da IA -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("failure", "code", "error_code"),
    [
        (AiLimitReached("limite"), "ai_limit_reached", "ai_limit_reached"),
        (AiUnavailable("fora do ar"), "ai_unavailable", "ai_unavailable"),
        (AiInvalidOutput("schema"), "ai_unavailable", "ai_invalid_output"),
    ],
)
def test_ai_failure_is_503_and_recorded(
    failure, code, error_code, db, users, world, use_ai, client_as, count_transactions
) -> None:
    use_ai(failure=failure)
    response = client_as(users["ruth"]).post(
        "/api/ingest", data={"text": "x"}, files={"file": ("f.png", image_bytes(), "image/png")}
    )

    assert response.status_code == 503
    body = response.json()
    assert body["code"] == code
    if code == "ai_limit_reached":
        assert body["detail"] == LIMIT_MESSAGE
    (extraction,) = db.scalars(select(AiExtraction)).all()
    assert (extraction.status, extraction.error_code) == ("error", error_code)
    assert extraction.attachment_id is not None
    assert extraction.prompt_version == PROMPT_VERSION
    assert _count(db, Draft) == 0
    assert count_transactions() == 0


def test_empty_api_key_is_503_ai_unavailable(
    db, users, world, settings, client_as, count_transactions
) -> None:
    # Sem override do cliente: usa o OpenAIClient real, que nem chega à rede sem chave.
    response = client_as(users["ruth"]).post("/api/ingest", data={"text": "gastei 10"})
    assert response.status_code == 503
    assert response.json()["code"] == "ai_unavailable"
    (extraction,) = db.scalars(select(AiExtraction)).all()
    assert (extraction.status, extraction.error_code) == ("error", "ai_unavailable")
    assert count_transactions() == 0


def test_item_out_of_range_is_dropped_with_warning(db, users, world, use_ai, client_as) -> None:
    """Data no limite do calendário (ex.: injeção de prompt) não vira 500: item ignorado."""
    data = load_fixture("comprovante_mercado")["output"]
    bad = dict(data["transactions"][0], date="9999-12-31", description="Item estranho")
    good = data["transactions"][0]
    use_ai(result=ExtractionResult.model_validate(data | {"transactions": [bad, good]}))

    response = client_as(users["ruth"]).post("/api/ingest", data={"text": "x"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["drafts"]) == 1
    assert any("Item estranho" in w and "ignorado" in w for w in body["warnings"])
    again = client_as(users["ruth"]).get(f"/api/ingest/{body['extraction_id']}").json()
    assert again["warnings"] == body["warnings"]


def test_extracao_grava_custo_estimado_em_centavos_de_dolar(
    db: Session, users, world, app, client_as
) -> None:
    from finance_api.ai.client import AiCall, get_ai_client

    data = load_fixture(FIXTURE_NAMES[0])

    class _Terra:
        def extract(self, *, context, text, images):
            return AiCall(
                result=ExtractionResult.model_validate(data["output"]),
                raw=data,
                model="gpt-6.1-terra-2026-10-01",
                usage_tokens=1_500_000,
                input_tokens=1_000_000,
                output_tokens=500_000,
                cached_input_tokens=0,
            )

    app.dependency_overrides[get_ai_client] = lambda: _Terra()
    body = client_as(users["ruth"]).post("/api/ingest", data={"text": "x"}).json()
    extraction = db.get(AiExtraction, body["extraction_id"])
    # US$ 1,00 de entrada + US$ 2,50 de saída
    assert extraction.est_cost_cents == 350
