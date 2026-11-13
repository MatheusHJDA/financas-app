"""Confirmar / descartar rascunhos: só `pending`, só quem enviou (ou admin), tudo ou nada."""

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session

from finance_api.ai.schemas import ExtractedTransaction, ExtractionResult
from finance_api.db.models import AuditLog, Draft, Transaction
from finance_api.transactions.router import WARNING_HEADER


def _ingest(client, use_ai, fixture: str | None = None, **kwargs) -> dict:
    use_ai(fixture, **kwargs)
    response = client.post("/api/ingest", data={"text": "teste"})
    assert response.status_code == 200, response.text
    return response.json()


def _single(**changes) -> ExtractionResult:
    values = {
        "kind": "expense",
        "amount_cents": 1000,
        "date": dt.date(2026, 11, 12),
        "description": "Compra",
        "account_hint": "Banco Inexistente",
        "to_account_hint": None,
        "category_hint": None,
        "owner_hint": None,
        "is_credit_card": False,
        "confidence": 0.9,
        "notes": None,
    }
    values.update(changes)
    return ExtractionResult(
        transactions=[ExtractedTransaction(**values)], document_type="free_text", warnings=[]
    )


def test_confirm_creates_one_transaction_and_second_confirm_is_409(
    db: Session, users, world, use_ai, client_as, count_transactions
) -> None:
    client = client_as(users["ruth"])
    body = _ingest(client, use_ai, "comprovante_mercado")
    (draft,) = body["drafts"]

    first = client.post(f"/api/drafts/{draft['id']}/confirm")
    second = client.post(f"/api/drafts/{draft['id']}/confirm")

    assert first.status_code == 200, first.text
    assert second.status_code == 409
    assert count_transactions() == 1
    tx = first.json()
    assert tx["source"] == "chat"
    assert tx["ai_extraction_id"] == body["extraction_id"]
    assert tx["amount_cents"] == 4590
    assert tx["account_id"] == world.nubank_ruth.id
    assert tx["category_id"] == world.categories["Mercado"].id
    assert tx["owner"] == "RUTH"
    assert tx["created_by"] == users["ruth"].id

    row = db.get(Draft, draft["id"])
    assert row.status == "confirmed"
    assert row.resolved_by == users["ruth"].id
    assert row.resolved_at is not None
    audit = db.scalars(
        select(AuditLog).where(AuditLog.entity == "drafts", AuditLog.entity_id == str(row.id))
    ).all()
    assert [(a.action, a.after_json["status"]) for a in audit] == [("update", "confirmed")]
    assert audit[0].after_json["transaction_id"] == tx["id"]
    tx_audit = select(AuditLog).where(
        AuditLog.entity == "transactions", AuditLog.entity_id == str(tx["id"])
    )
    assert db.scalars(tx_audit).one().action == "create"


def test_confirm_keeps_attachment_link(db, users, world, use_ai, client_as) -> None:
    from attachments.samples import image_bytes

    use_ai("comprovante_mercado")
    client = client_as(users["ruth"])
    body = client.post(
        "/api/ingest", files={"file": ("cupom.png", image_bytes(), "image/png")}
    ).json()
    tx = client.post(f"/api/drafts/{body['drafts'][0]['id']}/confirm").json()
    assert tx["attachment_id"] is not None


def test_confirm_with_edited_proposal(db, users, world, use_ai, client_as) -> None:
    client = client_as(users["ruth"])
    (draft,) = _ingest(client, use_ai, "comprovante_mercado")["drafts"]
    edited = dict(draft["payload"], amount_cents=4999, description="Mercado editado")

    response = client.post(f"/api/drafts/{draft['id']}/confirm", json=edited)

    assert response.status_code == 200, response.text
    assert response.json()["amount_cents"] == 4999
    assert response.json()["description"] == "Mercado editado"


def test_confirm_card_draft_sends_plan_rule_header(db, users, world, use_ai, client_as) -> None:
    client = client_as(users["ruth"])
    drafts = _ingest(client, use_ai, "fatura_cartao")["drafts"]
    loja = next(d for d in drafts if d["payload"]["description"] == "Loja Exemplo Centro")
    response = client.post(f"/api/drafts/{loja['id']}/confirm")
    assert response.status_code == 200
    assert WARNING_HEADER in response.headers


def test_confirm_without_account_is_422(
    db, users, world, use_ai, client_as, count_transactions
) -> None:
    client = client_as(users["ruth"])
    (draft,) = _ingest(client, use_ai, result=_single())["drafts"]
    assert draft["payload"]["account_id"] is None

    response = client.post(f"/api/drafts/{draft['id']}/confirm")

    assert response.status_code == 422
    assert count_transactions() == 0
    assert db.get(Draft, draft["id"]).status == "pending"
    edited = dict(draft["payload"], account_id=world.dinheiro.id)
    assert client.post(f"/api/drafts/{draft['id']}/confirm", json=edited).status_code == 200


def test_ruth_cannot_confirm_on_matheus_account(
    db, users, world, use_ai, client_as, count_transactions
) -> None:
    client = client_as(users["ruth"])
    (draft,) = _ingest(client, use_ai, "pix_sonia_matheus")["drafts"]
    assert draft["payload"]["account_id"] == world.sonia.id  # conta do Matheus

    response = client.post(f"/api/drafts/{draft['id']}/confirm")

    assert response.status_code == 403
    assert count_transactions() == 0
    assert db.get(Draft, draft["id"]).status == "pending"


def test_only_sender_or_admin_confirms_or_discards(
    db, users, world, use_ai, client_as, count_transactions
) -> None:
    matheus = client_as(users["matheus"])
    (draft,) = _ingest(matheus, use_ai, "texto_livre")["drafts"]

    ruth = client_as(users["ruth"])
    assert ruth.post(f"/api/drafts/{draft['id']}/confirm").status_code == 403
    assert ruth.post(f"/api/drafts/{draft['id']}/discard").status_code == 403
    batch = ruth.post("/api/drafts/confirm-batch", json={"draft_ids": [draft["id"]]})
    assert batch.status_code == 403
    assert count_transactions() == 0

    # Admin confirma rascunho enviado pela Ruth.
    (ruth_draft,) = _ingest(ruth, use_ai, "texto_livre")["drafts"]
    admin = client_as(users["matheus"])
    assert admin.post(f"/api/drafts/{ruth_draft['id']}/confirm").status_code == 200


def test_unknown_draft_is_404(db, users, world, use_ai, client_as) -> None:
    client = client_as(users["ruth"])
    assert client.post("/api/drafts/999999/confirm").status_code == 404
    assert client.post("/api/drafts/999999/discard").status_code == 404
    assert client.post("/api/drafts/confirm-batch", json={"draft_ids": [999999]}).status_code == 404


def test_discard_then_confirm_is_409(
    db, users, world, use_ai, client_as, count_transactions
) -> None:
    client = client_as(users["ruth"])
    (draft,) = _ingest(client, use_ai, "comprovante_mercado")["drafts"]

    assert client.post(f"/api/drafts/{draft['id']}/discard").status_code == 204
    assert client.post(f"/api/drafts/{draft['id']}/discard").status_code == 409
    assert client.post(f"/api/drafts/{draft['id']}/confirm").status_code == 409
    assert count_transactions() == 0
    row = db.get(Draft, draft["id"])
    assert (row.status, row.resolved_by) == ("discarded", users["ruth"].id)
    audit = db.scalars(
        select(AuditLog).where(AuditLog.entity == "drafts", AuditLog.entity_id == str(row.id))
    ).one()
    assert audit.after_json == {"status": "discarded"}


def test_batch_confirms_all(db, users, world, use_ai, client_as, count_transactions) -> None:
    client = client_as(users["ruth"])
    body = _ingest(client, use_ai, "extrato_varias_linhas")
    ids = [d["id"] for d in body["drafts"]]

    response = client.post("/api/drafts/confirm-batch", json={"draft_ids": ids})

    assert response.status_code == 200, response.text
    assert len(response.json()) == 4
    assert count_transactions() == 4
    statuses = db.scalars(select(Draft.status).where(Draft.id.in_(ids))).all()
    assert set(statuses) == {"confirmed"}


def test_batch_with_discarded_draft_creates_nothing(
    db, users, world, use_ai, client_as, count_transactions
) -> None:
    client = client_as(users["ruth"])
    ids = [d["id"] for d in _ingest(client, use_ai, "extrato_varias_linhas")["drafts"]]
    assert client.post(f"/api/drafts/{ids[2]}/discard").status_code == 204

    response = client.post("/api/drafts/confirm-batch", json={"draft_ids": ids})

    assert response.status_code == 409
    assert count_transactions() == 0
    statuses = {d.id: d.status for d in db.scalars(select(Draft).where(Draft.id.in_(ids)))}
    assert [statuses[i] for i in ids] == ["pending", "pending", "discarded", "pending"]


def test_batch_is_all_or_nothing_when_a_later_draft_is_forbidden(
    db, users, world, use_ai, client_as, count_transactions
) -> None:
    client = client_as(users["ruth"])
    ok_id = _ingest(client, use_ai, "comprovante_mercado")["drafts"][0]["id"]
    forbidden_id = _ingest(client, use_ai, "pix_sonia_matheus")["drafts"][0]["id"]

    response = client.post("/api/drafts/confirm-batch", json={"draft_ids": [ok_id, forbidden_id]})

    assert response.status_code == 403
    assert count_transactions() == 0
    assert db.get(Draft, ok_id).status == "pending"
    assert db.scalars(select(Transaction)).all() == []


def test_batch_rejects_empty_list(db, users, world, use_ai, client_as) -> None:
    client = client_as(users["ruth"])
    assert client.post("/api/drafts/confirm-batch", json={"draft_ids": []}).status_code == 422
