"""Ingestão por IA (U5): /ingest, /drafts, /attachments. Ligado no main.py pelo lead.

`POST /ingest` só cria rascunhos `pending`; o lançamento nasce em `/drafts/{id}/confirm` ou
`/drafts/confirm-batch`. A confirmação devolve os mesmos sinais de `POST /transactions` em
cabeçalhos (`X-Possible-Duplicate-Of`, `X-Plan-Rule-Warning`).
"""

from typing import Annotated

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi import status as http
from fastapi.responses import JSONResponse

from finance_api.ai.client import AiClient, AiInvalidOutput, AiLimitReached, get_ai_client
from finance_api.attachments.prepare import prepare
from finance_api.attachments.router import router as attachments_router
from finance_api.attachments.storage import read_limited, require_kind
from finance_api.core.config import Settings, get_settings
from finance_api.core.deps import DbSession, get_current_user
from finance_api.core.permissions import CurrentUser
from finance_api.ingest import service
from finance_api.ingest.schemas import (
    AiErrorOut,
    ConfirmBatch,
    IngestResult,
    ProposedTransaction,
)
from finance_api.transactions.router import DUPLICATE_HEADER, WARNING_HEADER
from finance_api.transactions.schemas import TransactionOut
from finance_api.transactions.service import TxResult

router = APIRouter(tags=["ingest"])
router.include_router(attachments_router)

User = Annotated[CurrentUser, Depends(get_current_user)]

AI_LIMIT_MESSAGE = "O limite mensal da IA foi atingido. Lance pelo formulário."
AI_UNAVAILABLE_MESSAGE = "A IA está indisponível agora. Lance pelo formulário."
AI_INVALID_MESSAGE = "A IA não conseguiu ler este envio. Lance pelo formulário."


def _ai_error_response(failure: Exception) -> JSONResponse:
    if isinstance(failure, AiLimitReached):
        body = AiErrorOut(detail=AI_LIMIT_MESSAGE, code="ai_limit_reached")
    elif isinstance(failure, AiInvalidOutput):
        body = AiErrorOut(detail=AI_INVALID_MESSAGE, code="ai_unavailable")
    else:
        body = AiErrorOut(detail=AI_UNAVAILABLE_MESSAGE, code="ai_unavailable")
    return JSONResponse(status_code=http.HTTP_503_SERVICE_UNAVAILABLE, content=body.model_dump())


@router.post(
    "/ingest",
    response_model=IngestResult,
    responses={
        413: {"description": "Arquivo grande demais"},
        503: {"model": AiErrorOut, "description": "IA indisponível ou limite atingido"},
    },
)
def ingest(
    db: DbSession,
    user: User,
    settings: Annotated[Settings, Depends(get_settings)],
    ai: Annotated[AiClient, Depends(get_ai_client)],
    text: Annotated[str | None, Form()] = None,
    file: Annotated[UploadFile | None, File()] = None,
) -> IngestResult | JSONResponse:
    text = text.strip() if text else None
    if text and len(text) > service.MAX_TEXT_CHARS:
        raise HTTPException(
            http.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Texto longo demais (máximo {service.MAX_TEXT_CHARS} caracteres).",
        )
    upload = None
    if file is not None and (file.filename or file.size):
        data = read_limited(file.file, settings.max_upload_bytes)
        kind = require_kind(data)
        upload = service.Upload(data=data, kind=kind, prepared=prepare(data, kind))
    if not text and upload is None:
        raise HTTPException(http.HTTP_422_UNPROCESSABLE_CONTENT, "Envie um texto ou um arquivo.")

    try:
        extraction, _drafts = service.ingest(
            db,
            user,
            ai,
            text=text,
            upload=upload,
            upload_dir=settings.upload_dir,
            model_name=settings.openai_model,
        )
    except service.IngestFailed as failed:
        db.commit()  # guarda o anexo e a extração com o erro (painel admin / U9)
        return _ai_error_response(failed.failure)
    db.commit()
    return service.ingest_result(db, extraction)


@router.get("/ingest/{extraction_id}", response_model=IngestResult)
def get_ingest(extraction_id: int, db: DbSession, user: User) -> IngestResult:
    return service.ingest_result(db, service.get_extraction(db, user, extraction_id))


def _signal(response: Response, result: TxResult) -> None:
    if result.possible_duplicates:
        response.headers[DUPLICATE_HEADER] = ",".join(str(t.id) for t in result.possible_duplicates)
    if result.plan_rule_warning:
        response.headers[WARNING_HEADER] = result.plan_rule_warning


@router.post("/drafts/confirm-batch", response_model=list[TransactionOut])
def confirm_batch(body: ConfirmBatch, db: DbSession, user: User) -> list[TransactionOut]:
    results = service.confirm_drafts(db, user, body.draft_ids)
    db.commit()
    return [TransactionOut.model_validate(r.transaction) for r in results]


@router.post("/drafts/{draft_id}/confirm", response_model=TransactionOut)
def confirm_draft(
    draft_id: int,
    response: Response,
    db: DbSession,
    user: User,
    body: Annotated[ProposedTransaction | None, Body()] = None,
) -> TransactionOut:
    (result,) = service.confirm_drafts(db, user, [draft_id], edited=body)
    db.commit()
    _signal(response, result)
    return TransactionOut.model_validate(result.transaction)


@router.post("/drafts/{draft_id}/discard", status_code=http.HTTP_204_NO_CONTENT)
def discard_draft(draft_id: int, db: DbSession, user: User) -> Response:
    service.discard_draft(db, user, draft_id)
    db.commit()
    return Response(status_code=http.HTTP_204_NO_CONTENT)
