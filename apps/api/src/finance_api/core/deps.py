from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from finance_api.core.permissions import CurrentUser
from finance_api.db.session import get_db

DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(request: Request, db: DbSession) -> CurrentUser:
    # Import local: auth.service não depende de deps, mas evita ciclo na carga dos módulos.
    from finance_api.auth import service
    from finance_api.core.config import get_settings

    user = service.authenticate_token(
        db, request.cookies.get(service.SESSION_COOKIE), get_settings()
    )
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Não autenticado.")
    return user


def require_admin(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Apenas o administrador.")
    return user
