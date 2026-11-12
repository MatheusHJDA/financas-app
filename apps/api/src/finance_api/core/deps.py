from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from finance_api.core.permissions import CurrentUser
from finance_api.db.session import get_db

DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(request: Request, db: DbSession) -> CurrentUser:
    # U1 implementa: ler o cookie `session`, validar o hash do token e devolver o usuário.
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Não autenticado.")


def require_admin(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Apenas o administrador.")
    return user
