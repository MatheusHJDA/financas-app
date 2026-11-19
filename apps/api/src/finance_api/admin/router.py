"""Rotas /admin/* (somente admin). U9.

`/admin/notifications/test` e `/admin/push-subscriptions` são da U7 (módulo notifications).
Toda rota exige `require_admin` (Ruth → 403); toda mutação grava auditoria sem segredos.
"""

import re
import stat
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select, text

from finance_api.auth import codes, limits
from finance_api.auth import service as auth_service
from finance_api.auth.router import PasskeyOut, passkey_out
from finance_api.core import app_settings
from finance_api.core.audit import record_audit
from finance_api.core.config import Settings, get_settings
from finance_api.core.deps import DbSession, require_admin
from finance_api.core.permissions import CurrentUser
from finance_api.db.models import AiExtraction, AuditLog, Passkey, Setting, User
from finance_api.notifications import lifecycle

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])

Admin = Annotated[CurrentUser, Depends(require_admin)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
Limit = Annotated[int, Query(ge=1, le=200)]
Offset = Annotated[int, Query(ge=0)]

PIN_LENGTH = 6
_HHMM = re.compile(r"^([01][0-9]|2[0-3]):[0-5][0-9]$")
_TIME_KEYS = (app_settings.DAILY_TIME, app_settings.BILL_TIME)


# --- schemas -------------------------------------------------------------------------------


class AdminUserOut(BaseModel):
    id: int
    name: str
    role: str
    failed_attempts: int
    passkey_count: int
    locked_at: datetime | None = None


class ResetPinBody(BaseModel):
    new_pin: str


class ReleaseCodeOut(BaseModel):
    code: str
    expires_at: datetime


class AiCallOut(BaseModel):
    id: int
    user_id: int
    input_kind: str
    model: str
    prompt_version: str
    usage_tokens: int | None = None
    est_cost_cents: int | None = None
    status: str
    error_code: str | None = None
    created_at: datetime


class AiCallPage(BaseModel):
    items: list[AiCallOut]
    total: int


class AuditEventOut(BaseModel):
    id: int
    user_id: int | None = None
    entity: str
    entity_id: str
    action: str
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    at: datetime


class AuditPage(BaseModel):
    items: list[AuditEventOut]
    total: int


class SystemStatus(BaseModel):
    database_ok: bool
    scheduler_ok: bool
    last_backup_at: datetime | None = None
    last_backup_size_bytes: int | None = None


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(422, detail=detail)


# --- usuários ------------------------------------------------------------------------------


def _get_user(db: DbSession, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado.")
    return user


@router.get("/users", response_model=list[AdminUserOut])
def list_users(db: DbSession) -> list[AdminUserOut]:
    users = db.scalars(select(User).order_by(User.id)).all()
    counts = {
        uid: n
        for uid, n in db.execute(
            select(Passkey.user_id, func.count()).group_by(Passkey.user_id)
        ).all()
    }
    return [
        AdminUserOut(
            id=u.id,
            name=u.name,
            role=u.role,
            failed_attempts=u.failed_attempts,
            passkey_count=counts.get(u.id, 0),
            locked_at=u.locked_at,
        )
        for u in users
    ]


@router.post("/users/{id}/reset-pin", status_code=status.HTTP_204_NO_CONTENT)
def reset_pin(
    id: int, body: ResetPinBody, request: Request, db: DbSession, admin: Admin
) -> Response:
    """Redefine o PIN (exatamente 6 dígitos), destrava a conta e revoga as sessões do usuário.

    Se o admin redefine o próprio PIN, a sessão atual (cookie desta requisição) é mantida;
    as demais sessões dele são revogadas. A auditoria não guarda PIN nem hash.
    """
    if not auth_service.is_valid_pin(body.new_pin) or len(body.new_pin) != PIN_LENGTH:
        raise _unprocessable(f"O PIN deve ter exatamente {PIN_LENGTH} dígitos.")
    if auth_service.is_weak_pin(body.new_pin):
        raise _unprocessable(auth_service.WEAK_PIN_MESSAGE)
    user = _get_user(db, id)
    keep: str | None = None
    if user.id == admin.id:
        keep = auth_service.hash_token(request.cookies.get(auth_service.SESSION_COOKIE) or "")
    user.pin_hash = auth_service.hash_pin(body.new_pin)
    limits.release_account(db, user)
    revoked = auth_service.revoke_user_sessions(db, user.id, actor_id=admin.id, keep_hash=keep)
    record_audit(
        db,
        user_id=admin.id,
        entity="users",
        entity_id=user.id,
        action="update",
        before={"pin_changed": False},
        after={"pin_changed": True, "sessions_revoked": revoked},
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/users/{id}/release-code", response_model=ReleaseCodeOut, status_code=status.HTTP_201_CREATED
)
def create_release_code(id: int, db: DbSession, admin: Admin) -> ReleaseCodeOut:
    """Gera um código de liberação (24 h, uso único). Aparece só nesta resposta."""
    user = _get_user(db, id)
    code, expires_at = codes.issue_release_code(
        db, user, actor_id=admin.id, now=auth_service.utcnow()
    )
    db.commit()
    return ReleaseCodeOut(code=code, expires_at=expires_at)


@router.post("/users/{id}/unlock", status_code=status.HTTP_204_NO_CONTENT)
def unlock_user(id: int, db: DbSession, admin: Admin) -> Response:
    """Tira a trava da conta (sem prazo) e zera a contagem dela."""
    user = _get_user(db, id)
    was_locked = user.locked_at is not None
    limits.release_account(db, user)
    record_audit(
        db,
        user_id=admin.id,
        entity="users",
        entity_id=user.id,
        action="update",
        before={"locked": was_locked},
        after={"locked": False, "unlocked": True},
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/users/{id}/passkeys", response_model=list[PasskeyOut])
def list_user_passkeys(id: int, db: DbSession) -> list[PasskeyOut]:
    user = _get_user(db, id)
    rows = db.scalars(select(Passkey).where(Passkey.user_id == user.id).order_by(Passkey.id))
    return [passkey_out(k) for k in rows]


@router.delete("/users/{id}/sessions", status_code=status.HTTP_204_NO_CONTENT)
def revoke_user_sessions(id: int, db: DbSession, admin: Admin) -> Response:
    user = _get_user(db, id)
    revoked = auth_service.revoke_user_sessions(db, user.id, actor_id=admin.id)
    record_audit(
        db,
        user_id=admin.id,
        entity="users",
        entity_id=user.id,
        action="update",
        before={"sessions_revoked": 0},
        after={"sessions_revoked": revoked},
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- configurações -------------------------------------------------------------------------


def _validate_settings(values: dict[str, Any]) -> None:
    unknown = sorted(set(values) - set(app_settings.DEFAULTS))
    if unknown:
        raise _unprocessable(f"Configuração desconhecida: {', '.join(unknown)}.")
    for key in _TIME_KEYS:
        if key in values:
            value = values[key]
            if not isinstance(value, str) or not _HHMM.match(value):
                raise _unprocessable(f"{key}: use o formato HH:MM (00:00 a 23:59).")
    if app_settings.BILL_DAYS_BEFORE in values:
        days = values[app_settings.BILL_DAYS_BEFORE]
        if isinstance(days, bool) or not isinstance(days, int) or not 0 <= days <= 10:
            raise _unprocessable(f"{app_settings.BILL_DAYS_BEFORE}: use um inteiro de 0 a 10.")


@router.get("/settings")
def get_admin_settings(db: DbSession) -> dict[str, Any]:
    return app_settings.get_all(db)


@router.put("/settings")
def put_admin_settings(body: dict[str, Any], db: DbSession, admin: Admin) -> dict[str, Any]:
    """Substitui as configurações: chaves ausentes voltam ao padrão (a linha é removida)."""
    _validate_settings(body)
    before = app_settings.get_all(db)
    for key in app_settings.DEFAULTS:
        row = db.get(Setting, key)
        if key in body:
            if row is None:
                db.add(Setting(key=key, value_json=body[key]))
            else:
                row.value_json = body[key]
        elif row is not None:
            db.delete(row)
    db.flush()
    after = app_settings.get_all(db)
    record_audit(
        db,
        user_id=admin.id,
        entity="settings",
        entity_id="admin",
        action="update",
        before=before,
        after=after,
    )
    db.commit()
    return after


# --- IA e auditoria ------------------------------------------------------------------------


@router.get("/ai/calls", response_model=AiCallPage)
def list_ai_calls(db: DbSession, limit: Limit = 50, offset: Offset = 0) -> AiCallPage:
    total = db.scalar(select(func.count()).select_from(AiExtraction)) or 0
    rows = db.scalars(
        select(AiExtraction)
        .order_by(AiExtraction.created_at.desc(), AiExtraction.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    items = [
        AiCallOut(
            id=r.id,
            user_id=r.user_id,
            input_kind=r.input_kind,
            model=r.model,
            prompt_version=r.prompt_version,
            usage_tokens=r.usage_tokens,
            est_cost_cents=r.est_cost_cents,
            status=r.status,
            error_code=r.error_code,
            created_at=r.created_at,
        )
        for r in rows
    ]
    return AiCallPage(items=items, total=total)


@router.get("/audit", response_model=AuditPage)
def list_audit(
    db: DbSession,
    entity: str | None = None,
    user_id: int | None = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> AuditPage:
    query = select(AuditLog)
    if entity:
        query = query.where(AuditLog.entity == entity)
    if user_id is not None:
        query = query.where(AuditLog.user_id == user_id)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(
        query.order_by(AuditLog.at.desc(), AuditLog.id.desc()).limit(limit).offset(offset)
    ).all()
    items = [
        AuditEventOut(
            id=r.id,
            user_id=r.user_id,
            entity=r.entity,
            entity_id=r.entity_id,
            action=r.action,
            before=r.before_json,
            after=r.after_json,
            at=r.at,
        )
        for r in rows
    ]
    return AuditPage(items=items, total=total)


# --- sistema e backup ----------------------------------------------------------------------


# nome gerado por infra/scripts/backup.sh
BACKUP_PATTERN = re.compile(r"^financas-\d{8}-\d{6}\.dump$")


def _latest_backup(settings: Settings) -> tuple[Path, float, int] | None:
    """(arquivo, mtime, tamanho) do backup mais novo de `settings.backup_dir`.

    Nunca usa caminho vindo do cliente; só arquivos regulares no padrão do backup.sh
    (links simbólicos e outros arquivos da pasta são ignorados).
    """
    folder = Path(settings.backup_dir)
    if not folder.is_dir():
        return None
    files: list[tuple[Path, float, int]] = []
    for entry in folder.iterdir():
        if not BACKUP_PATTERN.match(entry.name):
            continue
        try:
            info = entry.lstat()
        except OSError:
            continue
        if stat.S_ISREG(info.st_mode):
            files.append((entry, info.st_mtime, info.st_size))
    if not files:
        return None
    return max(files, key=lambda item: (item[1], item[0].name))


@router.get("/system", response_model=SystemStatus)
def system_status(db: DbSession, settings: SettingsDep) -> SystemStatus:
    try:
        db.execute(text("SELECT 1"))
        database_ok = True
    except Exception:
        database_ok = False
    backup = _latest_backup(settings)
    at: datetime | None = None
    size: int | None = None
    if backup is not None:
        _, mtime, size = backup
        at = datetime.fromtimestamp(mtime, tz=UTC)
    return SystemStatus(
        database_ok=database_ok,
        scheduler_ok=lifecycle.scheduler_ok(),
        last_backup_at=at,
        last_backup_size_bytes=size,
    )


@router.get("/backups/latest", response_class=FileResponse)
def download_latest_backup(settings: SettingsDep) -> FileResponse:
    backup = _latest_backup(settings)
    if backup is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nenhum backup encontrado.")
    path = backup[0]
    return FileResponse(path, filename=path.name, media_type="application/octet-stream")
