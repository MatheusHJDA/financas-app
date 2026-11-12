"""Schemas de contas (docs/api/openapi.yaml: Account, AccountCreate, AccountUpdate, AccountPage)."""

from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StringConstraints

from finance_api.core.permissions import Owner

AccountType = Literal["checking", "savings", "cash", "meal_voucher", "credit_card", "loan"]

# Dinheiro é sempre inteiro em centavos (nunca float); limite de sanidade abaixo do BIGINT.
Cents = Annotated[StrictInt, Field(ge=-(10**14), le=10**14)]
Day = Annotated[StrictInt, Field(ge=1, le=31)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class AccountCreate(BaseModel):
    owner: Owner
    name: Name
    type: AccountType
    institution: Annotated[str, Field(max_length=120)] | None = None
    last4: Annotated[str, Field(max_length=4)] | None = None
    initial_balance_cents: Cents
    initial_balance_date: date
    closing_day: Day | None = None
    due_day: Day | None = None
    active: StrictBool = True


class AccountUpdate(BaseModel):
    owner: Owner | None = None
    name: Name | None = None
    type: AccountType | None = None
    institution: Annotated[str, Field(max_length=120)] | None = None
    last4: Annotated[str, Field(max_length=4)] | None = None
    initial_balance_cents: Cents | None = None
    initial_balance_date: date | None = None
    closing_day: Day | None = None
    due_day: Day | None = None
    active: StrictBool | None = None


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner: Owner
    created_by: int
    name: str
    type: AccountType
    institution: str | None
    last4: str | None
    initial_balance_cents: int
    initial_balance_date: date
    closing_day: int | None
    due_day: int | None
    active: bool
    current_balance_cents: int


class AccountPage(BaseModel):
    items: list[AccountOut]
    total: int
