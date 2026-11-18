from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import select

from finance_api.auth import limits, passkeys, service
from finance_api.core.audit import record_audit
from finance_api.core.config import Settings, get_settings
from finance_api.core.deps import DbSession, get_current_user
from finance_api.core.permissions import CurrentUser, Owner
from finance_api.db.models import Passkey, UserSession
from finance_api.db.session import SessionFactory, get_session_factory
from finance_api.notifications.channels import NotificationChannel, get_channel

router = APIRouter(tags=["auth"])

CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]
SettingsDep = Annotated[Settings, Depends(get_settings)]

_ERR = {"description": "Erro padrão"}

LOGIN_FAILED = "Não foi possível entrar. Confira o nome e o PIN."
TOO_MANY_ATTEMPTS = "Muitas tentativas. Aguarde alguns minutos e tente de novo."


class AuthConfig(BaseModel):
    passkey_required: bool


class LoginRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    pin: str = Field(max_length=32)
    device_label: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
    ]


class LoginStartRequest(LoginRequest):
    release_code: str | None = Field(default=None, max_length=32)


class LoginStartOut(BaseModel):
    attempt_id: str
    mode: Literal["login", "register"]
    options: dict[str, Any]


class LoginFinishRequest(BaseModel):
    attempt_id: str = Field(min_length=1, max_length=128)
    credential: dict[str, Any]


class Me(BaseModel):
    id: int
    name: str
    role: str
    owner: Owner


class LoginFinishOut(BaseModel):
    me: Me
    recovery_codes: list[str] | None


class SessionOut(BaseModel):
    id: int
    device_label: str
    created_at: datetime
    expires_at: datetime
    current: bool


class PasskeyOut(BaseModel):
    id: int
    device_label: str
    created_at: datetime
    last_used_at: datetime | None = None


def passkey_out(key: Passkey) -> PasskeyOut:
    return PasskeyOut(
        id=key.id,
        device_label=key.device_label,
        created_at=key.created_at,
        last_used_at=key.last_used_at,
    )


def _set_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        service.SESSION_COOKIE,
        token,
        max_age=(
            settings.session_max_hours * 3600
            if settings.require_passkey
            else settings.session_days * 86400
        ),
        httponly=True,
        secure=True,
        samesite="strict",
        path="/",
    )


def _clear_cookie(response: Response) -> None:
    response.delete_cookie(
        service.SESSION_COOKIE, path="/", httponly=True, secure=True, samesite="strict"
    )


def _me(user: CurrentUser) -> Me:
    return Me(id=user.id, name=user.name, role=user.role, owner=user.owner)


def _current_hash(request: Request) -> str:
    return service.hash_token(request.cookies.get(service.SESSION_COOKIE) or "")


@router.get("/auth/config", response_model=AuthConfig)
def auth_config(settings: SettingsDep) -> AuthConfig:
    return AuthConfig(passkey_required=settings.require_passkey)


@router.post("/auth/login", response_model=Me, responses={401: _ERR, 429: _ERR})
def login(
    body: LoginRequest, request: Request, response: Response, db: DbSession, settings: SettingsDep
) -> Me:
    if settings.require_passkey:  # só PIN não abre sessão quando a chave é exigida
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=LOGIN_FAILED)
    try:
        result = service.login(
            db,
            name=body.name,
            pin=body.pin,
            device_label=body.device_label,
            source=limits.request_source(request),
            settings=settings,
        )
    except service.InvalidCredentials:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=LOGIN_FAILED) from None
    except service.SourceBlocked as exc:
        raise _source_blocked(exc) from None
    current = service.to_current_user(result.user)
    assert current is not None
    _set_cookie(response, result.token, settings)
    return _me(current)


def _source_blocked(exc: service.SourceBlocked) -> HTTPException:
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS,
        detail=TOO_MANY_ATTEMPTS,
        headers={"Retry-After": str(exc.retry_after_seconds)},
    )


def _require_passkey_on(settings: Settings) -> None:
    if not settings.require_passkey:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Chave de acesso desligada.")


@router.post("/auth/login/start", response_model=LoginStartOut, responses={404: _ERR, 429: _ERR})
def login_start(
    body: LoginStartRequest, request: Request, db: DbSession, settings: SettingsDep
) -> LoginStartOut:
    """Etapa 1: nunca diz se nome/PIN estão certos; sempre devolve um desafio."""
    _require_passkey_on(settings)
    release_code = (body.release_code or "").strip() or None
    try:
        attempt_id, options = passkeys.start(
            db,
            name=body.name,
            pin=body.pin,
            release_code=release_code,
            device_label=body.device_label,
            source=limits.request_source(request),
            settings=settings,
        )
    except service.SourceBlocked as exc:
        raise _source_blocked(exc) from None
    return LoginStartOut(
        attempt_id=attempt_id, mode="register" if release_code else "login", options=options
    )


@router.post(
    "/auth/login/finish",
    response_model=LoginFinishOut,
    responses={401: _ERR, 404: _ERR, 429: _ERR},
)
def login_finish(
    body: LoginFinishRequest,
    request: Request,
    response: Response,
    db: DbSession,
    settings: SettingsDep,
    channel: Annotated[NotificationChannel, Depends(get_channel)],
    session_factory: Annotated[SessionFactory, Depends(get_session_factory)],
    background: BackgroundTasks,
) -> LoginFinishOut:
    """Etapa 2: o único veredito. Qualquer falha responde 401 com a mesma mensagem."""
    _require_passkey_on(settings)
    try:
        result = passkeys.finish(
            db,
            attempt_id=body.attempt_id,
            credential=body.credential,
            source=limits.request_source(request),
            settings=settings,
        )
    except service.InvalidCredentials:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=LOGIN_FAILED) from None
    except service.SourceBlocked as exc:
        raise _source_blocked(exc) from None
    current = service.to_current_user(result.user)
    assert current is not None
    _set_cookie(response, result.token, settings)
    if result.new_device_label is not None:  # depois da resposta: o envio pode demorar
        background.add_task(
            passkeys.notify_new_device,
            session_factory,
            channel,
            result.user.id,
            result.new_device_label,
        )
    return LoginFinishOut(me=_me(current), recovery_codes=result.recovery_codes)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT, responses={401: _ERR})
def logout(request: Request, db: DbSession, user: CurrentUserDep) -> Response:
    session = service.find_active_session(
        db, request.cookies.get(service.SESSION_COOKIE), service.utcnow()
    )
    if session is not None:
        service.revoke_session(db, session, actor_id=user.id, audit=False)
        db.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _clear_cookie(response)
    return response


@router.get("/auth/me", response_model=Me, responses={401: _ERR})
def me(request: Request, response: Response, user: CurrentUserDep, settings: SettingsDep) -> Me:
    # A validade no servidor já foi renovada em get_current_user; renova também o cookie.
    token = request.cookies.get(service.SESSION_COOKIE)
    if token:
        _set_cookie(response, token, settings)
    return _me(user)


@router.get("/auth/sessions", response_model=list[SessionOut], responses={401: _ERR})
def list_sessions(
    request: Request, db: DbSession, user: CurrentUserDep, settings: SettingsDep
) -> list[SessionOut]:
    current_hash = _current_hash(request)
    query = select(UserSession).where(
        UserSession.user_id == user.id,
        UserSession.revoked_at.is_(None),
        UserSession.expires_at > service.utcnow(),
    )
    if settings.require_passkey:  # sessões só com PIN não valem mais: não são "ativas"
        query = query.where(UserSession.two_factor.is_(True))
    rows = db.execute(
        query.order_by(UserSession.created_at.desc(), UserSession.id.desc())
    ).scalars()
    return [
        SessionOut(
            id=s.id,
            device_label=s.device_label,
            created_at=s.created_at,
            expires_at=s.expires_at,
            current=s.token_hash == current_hash,
        )
        for s in rows
    ]


@router.delete(
    "/auth/sessions/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def revoke_session(id: int, request: Request, db: DbSession, user: CurrentUserDep) -> Response:
    target = db.get(UserSession, id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Sessão não encontrada.")
    if target.user_id != user.id and user.role != "admin":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="Você só pode revogar as suas próprias sessões."
        )
    is_current = target.token_hash == _current_hash(request)
    service.revoke_session(db, target, actor_id=user.id)
    db.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    if is_current:
        _clear_cookie(response)
    return response


@router.get("/auth/passkeys", response_model=list[PasskeyOut], responses={401: _ERR})
def list_passkeys(db: DbSession, user: CurrentUserDep) -> list[PasskeyOut]:
    rows = db.scalars(select(Passkey).where(Passkey.user_id == user.id).order_by(Passkey.id))
    return [passkey_out(k) for k in rows]


@router.delete(
    "/auth/passkeys/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def delete_passkey(id: int, request: Request, db: DbSession, user: CurrentUserDep) -> Response:
    """Remove uma chave (dona ou admin). Remover a última é permitido: códigos recuperam.

    O aparelho da chave não pode continuar conectado: as sessões da dona caem, menos a de quem
    remove (quando é a própria dona). Sessões não guardam a chave usada, então caem todas as outras.
    """
    key = db.get(Passkey, id)
    if key is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Chave não encontrada.")
    if key.user_id != user.id and user.role != "admin":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="Você só pode remover as suas próprias chaves."
        )
    keep = _current_hash(request) if key.user_id == user.id else None
    revoked = service.revoke_user_sessions(db, key.user_id, actor_id=user.id, keep_hash=keep)
    record_audit(
        db,
        user_id=user.id,
        entity="passkeys",
        entity_id=key.id,
        action="delete",
        before={"user_id": key.user_id, "device_label": key.device_label},
        after={"sessions_revoked": revoked},
    )
    db.delete(key)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
