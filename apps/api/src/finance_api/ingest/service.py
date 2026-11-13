"""Ingestão: extração → rascunhos; confirmação → lançamentos.

Regra que não pode falhar: **nenhum caminho de `ingest` grava lançamento**. Só `confirm_drafts`
cria, e só a partir de rascunho `pending`, com as permissões de `create_transaction` (U2).
Nenhuma função faz commit; o router confirma.
"""

import datetime as dt
import logging
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from finance_api.ai.client import AiCall, AiClient, AiFailure
from finance_api.ai.context import build_context, today_sp
from finance_api.ai.schemas import PROMPT_VERSION, ExtractionResult
from finance_api.attachments.prepare import PreparedInput
from finance_api.attachments.storage import FileKind, save_attachment
from finance_api.core.audit import record_audit
from finance_api.core.permissions import CurrentUser
from finance_api.db.models import Account, AiExtraction, Category, Draft
from finance_api.ingest.resolve import draft_signals, resolve_transaction
from finance_api.ingest.schemas import DraftOut, IngestResult, ProposedTransaction
from finance_api.transactions.service import TxData, TxResult, create_transaction

log = logging.getLogger(__name__)

MAX_TEXT_CHARS = 20_000


@dataclass
class Upload:
    data: bytes
    kind: FileKind
    prepared: PreparedInput


class IngestFailed(Exception):
    """A IA falhou; a extração já foi gravada com o erro (o router faz commit e responde 503)."""

    def __init__(self, extraction: AiExtraction, failure: AiFailure) -> None:
        super().__init__(failure.code)
        self.extraction = extraction
        self.failure = failure


# --- Ingestão ---------------------------------------------------------------------------------


def _input_kind(text: str | None, upload: Upload | None) -> str:
    if upload is None:
        return "text"
    return upload.prepared.input_kind


def _ai_text(text: str | None, upload: Upload | None) -> str | None:
    parts = []
    if text:
        parts.append(text)
    if upload is not None and upload.prepared.text:
        # O texto do PDF é dado, não instrução: vai delimitado (ver INSTRUCTIONS da IA).
        document = upload.prepared.text.replace("</documento>", "</ documento>")
        parts.append("TEXTO EXTRAÍDO DO PDF:\n<documento>\n" + document + "\n</documento>")
    return "\n\n".join(parts) or None


def ingest(
    db: Session,
    user: CurrentUser,
    ai: AiClient,
    *,
    text: str | None,
    upload: Upload | None,
    upload_dir: str,
    model_name: str,
    today: dt.date | None = None,
) -> tuple[AiExtraction, list[Draft]]:
    """Chama a IA e grava anexo, extração e rascunhos `pending`. Nunca cria lançamento.

    Falha da IA → grava a extração com `status="error"` e levanta `IngestFailed`.
    """
    today = today or today_sp()
    context = build_context(db, user, today=today)
    images = upload.prepared.images if upload is not None else []

    call: AiCall | None = None
    failure: AiFailure | None = None
    try:
        call = ai.extract(context=context, text=_ai_text(text, upload), images=images)
    except AiFailure as error:
        failure = error
        log.warning("Ingestão: IA falhou (%s).", error.code)

    attachment_id = None
    if upload is not None:
        attachment = save_attachment(db, user, upload.data, upload.kind, upload_dir, today=today)
        attachment_id = attachment.id

    extraction = AiExtraction(
        user_id=user.id,
        attachment_id=attachment_id,
        input_kind=_input_kind(text, upload),
        model=((call.model if call else model_name) or "")[:80],
        prompt_version=PROMPT_VERSION,
        raw_output_json=call.raw if call else None,
        usage_tokens=call.usage_tokens if call else None,
        status="ok" if call else "error",
        error_code=failure.code if failure else None,
    )
    db.add(extraction)
    db.flush()
    if call is None:
        assert failure is not None
        raise IngestFailed(extraction, failure)

    drafts = _create_drafts(db, user, extraction, call.result)
    return extraction, drafts


def _create_drafts(
    db: Session, user: CurrentUser, extraction: AiExtraction, result: ExtractionResult
) -> list[Draft]:
    accounts = list(db.scalars(select(Account).where(Account.active.is_(True))))
    categories = list(db.scalars(select(Category)))
    drafts: list[Draft] = []
    dropped: list[str] = []
    for item in result.transactions:
        try:
            resolution = resolve_transaction(item, accounts, categories, user)
            signals = draft_signals(db, resolution)
        except (ValidationError, OverflowError):
            log.warning("Ingestão: lançamento extraído fora dos limites; ignorado.")
            dropped.append(
                f"Um lançamento lido ({item.description[:60]}) tinha valor ou data fora dos "
                "limites e foi ignorado; lance pelo formulário se ele existir."
            )
            continue
        draft = Draft(
            ai_extraction_id=extraction.id,
            status="pending",
            payload_json={
                "proposal": resolution.proposal.model_dump(mode="json"),
                "confidence": resolution.confidence,
                "low_confidence_fields": resolution.low_confidence_fields,
                "duplicate_of_transaction_id": signals.duplicate_of_transaction_id,
                "plan_rule_warning": signals.plan_rule_warning,
                "suggested_bill_instance_id": signals.suggested_bill_instance_id,
                "warnings": resolution.warnings,
                "extracted": item.model_dump(mode="json"),
            },
        )
        db.add(draft)
        drafts.append(draft)
    if dropped:
        # Avisos do servidor ficam ao lado da saída bruta (que não é alterada).
        extraction.raw_output_json = {
            **(extraction.raw_output_json or {}),
            "server_warnings": dropped,
        }
    db.flush()
    return drafts


def draft_out(draft: Draft) -> DraftOut:
    payload: dict[str, Any] = draft.payload_json
    return DraftOut(
        id=draft.id,
        status=draft.status,
        payload=ProposedTransaction.model_validate(payload["proposal"]),
        confidence=payload["confidence"],
        low_confidence_fields=payload["low_confidence_fields"],
        duplicate_of_transaction_id=payload.get("duplicate_of_transaction_id"),
        plan_rule_warning=payload.get("plan_rule_warning"),
        suggested_bill_instance_id=payload.get("suggested_bill_instance_id"),
    )


def ingest_result(db: Session, extraction: AiExtraction) -> IngestResult:
    output = (extraction.raw_output_json or {}).get("output") or {}
    drafts = list(
        db.scalars(select(Draft).where(Draft.ai_extraction_id == extraction.id).order_by(Draft.id))
    )
    warnings = list(output.get("warnings") or [])
    warnings.extend((extraction.raw_output_json or {}).get("server_warnings") or [])
    for draft in drafts:
        warnings.extend(draft.payload_json.get("warnings") or [])
    return IngestResult(
        extraction_id=extraction.id,
        document_type=output.get("document_type") or "other",
        warnings=warnings,
        drafts=[draft_out(d) for d in drafts],
    )


def get_extraction(db: Session, user: CurrentUser, extraction_id: int) -> AiExtraction:
    """Quem enviou ou admin; senão 404 (não revela que existe)."""
    extraction = db.get(AiExtraction, extraction_id)
    if extraction is None or (user.role != "admin" and extraction.user_id != user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Extração não encontrada.")
    return extraction


# --- Rascunhos --------------------------------------------------------------------------------


def _lock_drafts(db: Session, user: CurrentUser, draft_ids: list[int]) -> list[Draft]:
    """Trava os rascunhos (`SELECT … FOR UPDATE`) e checa existência, dono e estado.

    Ordem: 404 → 403 (só quem enviou ou admin) → 409 (só `pending`).
    """
    unique_ids = list(dict.fromkeys(draft_ids))
    rows = db.execute(
        select(Draft, AiExtraction.user_id)
        .join(AiExtraction, AiExtraction.id == Draft.ai_extraction_id)
        .where(Draft.id.in_(unique_ids))
        .order_by(Draft.id)
        .with_for_update(of=Draft)
        .execution_options(populate_existing=True)
    ).all()
    found = {draft.id: (draft, sender_id) for draft, sender_id in rows}
    if len(found) != len(unique_ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rascunho não encontrado.")
    for _draft, sender_id in found.values():
        if user.role != "admin" and sender_id != user.id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Só quem enviou pode confirmar ou descartar."
            )
    for draft, _ in found.values():
        if draft.status != "pending":
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"O rascunho {draft.id} já foi {_STATUS.get(draft.status, draft.status)}.",
            )
    return [found[i][0] for i in unique_ids]


_STATUS = {"confirmed": "confirmado", "discarded": "descartado", "pending": "pendente"}


def _confirm_one(
    db: Session, user: CurrentUser, draft: Draft, edited: ProposedTransaction | None
) -> TxResult:
    proposal = edited or ProposedTransaction.model_validate(draft.payload_json["proposal"])
    if proposal.account_id is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Escolha a conta antes de confirmar."
        )
    if proposal.kind == "transfer" and proposal.to_account_id is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Escolha a conta de destino da transferência."
        )
    extraction = db.get(AiExtraction, draft.ai_extraction_id)
    assert extraction is not None
    result = create_transaction(
        db,
        user,
        TxData(
            kind=proposal.kind,
            amount_cents=proposal.amount_cents,
            date=proposal.date,
            description=proposal.description,
            account_id=proposal.account_id,
            to_account_id=proposal.to_account_id if proposal.kind == "transfer" else None,
            category_id=proposal.category_id,
            owner=(proposal.owner or user.owner).value,
        ),
        source="chat",
        attachment_id=extraction.attachment_id,
        ai_extraction_id=extraction.id,
    )
    before = {"status": draft.status}
    draft.status = "confirmed"
    draft.resolved_by = user.id
    draft.resolved_at = dt.datetime.now(dt.UTC)
    record_audit(
        db,
        user_id=user.id,
        entity="drafts",
        entity_id=draft.id,
        action="update",
        before=before,
        after={
            "status": "confirmed",
            "transaction_id": result.transaction.id,
            "edited": edited is not None,
        },
    )
    db.flush()
    return result


def confirm_drafts(
    db: Session,
    user: CurrentUser,
    draft_ids: list[int],
    edited: ProposedTransaction | None = None,
) -> list[TxResult]:
    """Confirma um ou mais rascunhos: tudo ou nada (savepoint), na ordem pedida.

    `edited` (só para um rascunho) substitui a proposta guardada.
    """
    if edited is not None and len(draft_ids) != 1:
        raise ValueError("Proposta editada só vale para um rascunho.")
    drafts = _lock_drafts(db, user, draft_ids)
    with db.begin_nested():
        return [_confirm_one(db, user, draft, edited) for draft in drafts]


def discard_draft(db: Session, user: CurrentUser, draft_id: int) -> None:
    (draft,) = _lock_drafts(db, user, [draft_id])
    before = {"status": draft.status}
    draft.status = "discarded"
    draft.resolved_by = user.id
    draft.resolved_at = dt.datetime.now(dt.UTC)
    record_audit(
        db,
        user_id=user.id,
        entity="drafts",
        entity_id=draft.id,
        action="update",
        before=before,
        after={"status": "discarded"},
    )
    db.flush()
