from datetime import date

from pydantic import BaseModel, ConfigDict, Field

from finance_api.core.permissions import Owner


class RecurringBillOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner: Owner
    name: str
    amount_cents: int
    due_day: int
    start_month: date
    end_month: date | None = None
    account_id: int | None = None
    category_id: int | None = None
    payment_method: str | None = None


class RecurringBillCreate(BaseModel):
    owner: Owner
    name: str = Field(min_length=1, max_length=120)
    amount_cents: int = Field(gt=0)
    due_day: int = Field(ge=1, le=31)
    start_month: date
    end_month: date | None = None
    account_id: int | None = None
    category_id: int | None = None
    payment_method: str | None = Field(default=None, max_length=40)


class RecurringBillUpdate(BaseModel):
    owner: Owner | None = None
    name: str | None = Field(default=None, min_length=1, max_length=120)
    amount_cents: int | None = Field(default=None, gt=0)
    due_day: int | None = Field(default=None, ge=1, le=31)
    start_month: date | None = None
    end_month: date | None = None
    account_id: int | None = None
    category_id: int | None = None
    payment_method: str | None = Field(default=None, max_length=40)


class RecurringBillPage(BaseModel):
    items: list[RecurringBillOut]
    total: int


class BillInstanceOut(BaseModel):
    id: int
    recurring_bill_id: int
    name: str | None = None
    owner: Owner | None = None
    month: date
    due_date: date
    amount_cents: int
    status: str
    paid_transaction_id: int | None = None


class BillInstancePage(BaseModel):
    items: list[BillInstanceOut]
    total: int


class BillPayRequest(BaseModel):
    transaction_id: int | None = None
