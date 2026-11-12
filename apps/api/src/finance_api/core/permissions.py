"""Regras de escrita (D6/D12). Interface congelada para U1/U2/U4."""

from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

from fastapi import HTTPException, status


class Owner(StrEnum):
    RUTH = "RUTH"
    MATHEUS = "MATHEUS"
    AMBOS = "AMBOS"


@dataclass(frozen=True)
class CurrentUser:
    id: int
    name: str
    role: Literal["admin", "member"]
    owner: Owner  # RUTH ou MATHEUS


def can_write(user: CurrentUser, record_owner: Owner) -> bool:
    """Admin pode tudo; registros AMBOS valem para os dois; senão só o dono."""
    if user.role == "admin":
        return True
    if record_owner == Owner.AMBOS:
        return True
    return user.owner == record_owner


def ensure_can_write(user: CurrentUser, record_owner: Owner) -> None:
    if not can_write(user, record_owner):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Você não pode alterar registros de outro usuário.",
        )
