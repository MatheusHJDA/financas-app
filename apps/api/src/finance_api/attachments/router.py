"""`GET /attachments/{id}`: qualquer usuário logado baixa o anexo (incluído pelo router do ingest).

Responde com o tipo detectado no envio (o conteúdo foi validado por magic bytes) e
`X-Content-Type-Options: nosniff` e `Content-Security-Policy: default-src 'none'`
(o PDF/imagem continua abrindo inline). O caminho no disco tem de ficar dentro de `upload_dir`.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse

from finance_api.attachments.storage import resolve_path
from finance_api.core.config import Settings, get_settings
from finance_api.core.deps import DbSession, get_current_user
from finance_api.core.permissions import CurrentUser
from finance_api.db.models import Attachment

router = APIRouter(tags=["ingest"])

_NOT_FOUND = "Anexo não encontrado."


@router.get(
    "/attachments/{attachment_id}",
    response_class=FileResponse,
    responses={200: {"content": {"application/octet-stream": {}}}},
)
def get_attachment(
    attachment_id: int,
    db: DbSession,
    _user: Annotated[CurrentUser, Depends(get_current_user)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> FileResponse:
    attachment = db.get(Attachment, attachment_id)
    if attachment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, _NOT_FOUND)
    path = resolve_path(settings.upload_dir, attachment.path)
    if path is None or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, _NOT_FOUND)
    return FileResponse(
        path,
        media_type=attachment.mime,
        filename=f"anexo-{attachment.id}{path.suffix}",
        content_disposition_type="inline",
        headers={
            "X-Content-Type-Options": "nosniff",
            # conteúdo enviado por usuário: nada executa nem carrega recurso
            "Content-Security-Policy": "default-src 'none'",
        },
    )
