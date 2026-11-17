import datetime as dt
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from finance_api.core.permissions import Owner

Rate = Annotated[Decimal, Field(ge=0, lt=100, max_digits=8, decimal_places=6)]


class DebtOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner: Owner
    name: str
    principal_cents: int
    monthly_rate: Decimal  # fração decimal (0.0345 = 3,45% a.m.), serializada como string
    installments: int
    installment_cents: int
    start_date: dt.date
    current_balance_cents: int
    paid_before_app_cents: int
    has_installments: bool = False  # preenchido pela rota (há parcelas cadastradas)

    @field_serializer("monthly_rate")
    def _rate_str(self, value: Decimal) -> str:
        return format(value.quantize(Decimal("0.000001")), "f")  # Numeric(8,6)


class DebtCreate(BaseModel):
    owner: Owner
    name: str = Field(min_length=1, max_length=120)
    principal_cents: int = Field(gt=0)
    monthly_rate: Rate
    installments: int = Field(ge=1)
    installment_cents: int = Field(ge=0)
    start_date: dt.date
    current_balance_cents: int = Field(ge=0)


class DebtUpdate(BaseModel):
    owner: Owner | None = None
    name: str | None = Field(default=None, min_length=1, max_length=120)
    principal_cents: int | None = Field(default=None, gt=0)
    monthly_rate: Rate | None = None
    installments: int | None = Field(default=None, ge=1)
    installment_cents: int | None = Field(default=None, ge=0)
    start_date: dt.date | None = None
    current_balance_cents: int | None = Field(default=None, ge=0)


class DebtPage(BaseModel):
    items: list[DebtOut]
    total: int


class InstallmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    number: int
    due_date: dt.date
    face_cents: int
    today_cents: int | None  # valor para quitar hoje; nulo se já paga/adiantada
    savings_cents: int | None  # cheio − hoje; nulo se já paga/adiantada
    status: Literal["open", "paid", "prepaid"]
    paid_cents: int | None
    paid_on: dt.date | None
    bill_instance_id: int


class LoanSummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    remaining_cents: int
    paid_cents: int
    payoff_today_cents: int
    items: list[InstallmentOut]


class PayInstallmentsIn(BaseModel):
    installment_ids: list[int] = Field(min_length=1)
    amount_cents: int = Field(gt=0)
    account_id: int
    date: dt.date
