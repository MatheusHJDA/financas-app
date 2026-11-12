from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import select

from finance_api.auth import service
from finance_api.auth.identity import OWNER_BY_USER_NAME
from finance_api.core.config import Settings, get_settings
from finance_api.core.deps import DbSession, get_current_user
from finance_api.core.permissions import CurrentUser, Owner
from finance_api.db.models import User, UserSession

router = APIRouter(tags=["auth"])

CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]
SettingsDep = Annotated[Settings, Depends(get_settings)]

_ERR = {"description": "Erro padrão"}


class LoginUser(BaseModel):
    id: int
    name: str


class LoginRequest(BaseModel):
    user_id: int
    pin: str = Field(max_length=32)
    device_label: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
    ]


class Me(BaseModel):
    id: int
    name: str
    role: str
    owner: Owner


class SessionOut(BaseModel):
    id: int
    device_label: str
    created_at: datetime
    expires_at: datetime
    current: bool


def _set_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        service.SESSION_COOKIE,
        token,
        max_age=settings.session_days * 86400,
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


@router.get("/auth/users", response_model=list[LoginUser])
def list_login_users(db: DbSession) -> list[LoginUser]:
    rows = db.execute(select(User).order_by(User.id)).scalars()
    return [LoginUser(id=u.id, name=u.name) for u in rows if u.name in OWNER_BY_USER_NAME]


@router.post("/auth/login", response_model=Me, responses={401: _ERR, 423: _ERR})
def login(body: LoginRequest, response: Response, db: DbSession, settings: SettingsDep) -> Me:
    try:
        result = service.login(
            db,
            user_id=body.user_id,
            pin=body.pin,
            device_label=body.device_label,
            settings=settings,
        )
    except service.InvalidCredentials:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, detail="Usuário ou PIN incorreto."
        ) from None
    except service.AccountLocked as exc:
        raise HTTPException(
            status.HTTP_423_LOCKED,
            detail="Acesso bloqueado temporariamente. Tente novamente mais tarde.",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from None
    current = service.to_current_user(result.user)
    assert current is not None
    _set_cookie(response, result.token, settings)
    return _me(current)


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
def list_sessions(request: Request, db: DbSession, user: CurrentUserDep) -> list[SessionOut]:
    current_hash = _current_hash(request)
    rows = db.execute(
        select(UserSession)
        .where(
            UserSession.user_id == user.id,
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > service.utcnow(),
        )
        .order_by(UserSession.created_at.desc(), UserSession.id.desc())
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
