"""Modelos de todas as tabelas (ORQUESTRACAO.md, seção 7). Congelado em U0.

Dinheiro: sempre centavos inteiros (BigInteger, sufixo `_cents`).
Instantes: timestamptz (UTC no banco). Datas de negócio: `date`.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Identity,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from finance_api.db.base import Base

# --- Enums nativos do Postgres (cada tipo é criado uma única vez) -----------------------------

USER_ROLE = Enum("admin", "member", name="user_role")
OWNER = Enum("RUTH", "MATHEUS", "AMBOS", name="owner")
ACCOUNT_TYPE = Enum(
    "checking", "savings", "cash", "meal_voucher", "credit_card", "loan", name="account_type"
)
CATEGORY_KIND = Enum("income", "expense", name="category_kind")
TX_KIND = Enum("income", "expense", "transfer", name="tx_kind")
TX_STATUS = Enum("confirmed", name="tx_status")
TX_SOURCE = Enum("chat", "manual", "import", name="tx_source")
DRAFT_STATUS = Enum("pending", "confirmed", "discarded", name="draft_status")
BILL_STATUS = Enum("open", "paid", "prepaid", name="bill_status")
INSTALLMENT_STATUS = Enum("open", "paid", "prepaid", name="installment_status")

ENUMS = (
    USER_ROLE,
    OWNER,
    ACCOUNT_TYPE,
    CATEGORY_KIND,
    TX_KIND,
    TX_STATUS,
    TX_SOURCE,
    DRAFT_STATUS,
    BILL_STATUS,
    INSTALLMENT_STATUS,
)

# --- Tipos auxiliares -------------------------------------------------------------------------


def _pk() -> Mapped[int]:
    return mapped_column(BigInteger, Identity(), primary_key=True)


def _fk(target: str, *, ondelete: str, nullable: bool = False, **kw: Any) -> Mapped[Any]:
    return mapped_column(BigInteger, ForeignKey(target, ondelete=ondelete, **kw), nullable=nullable)


def _created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def _updated_at() -> Mapped[datetime]:
    return mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


def _tstz(*, nullable: bool = True) -> Mapped[Any]:
    return mapped_column(DateTime(timezone=True), nullable=nullable)


# --- Tabelas ----------------------------------------------------------------------------------


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = _pk()
    name: Mapped[str] = mapped_column(String(80), unique=True)
    role: Mapped[str] = mapped_column(USER_ROLE)
    pin_hash: Mapped[str] = mapped_column(Text)
    failed_attempts: Mapped[int] = mapped_column(Integer, server_default="0")
    locked_until: Mapped[datetime | None] = _tstz()
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()


class UserSession(Base):
    """Sessão por aparelho. Só o hash do token é guardado (`token_hash`)."""

    __tablename__ = "sessions"

    id: Mapped[int] = _pk()
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[int] = _fk("users.id", ondelete="CASCADE")
    device_label: Mapped[str] = mapped_column(String(120))
    expires_at: Mapped[datetime] = _tstz(nullable=False)
    revoked_at: Mapped[datetime | None] = _tstz()
    created_at: Mapped[datetime] = _created_at()

    __table_args__ = (Index("ix_sessions_user_id", "user_id"),)


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = _pk()
    owner: Mapped[str] = mapped_column(OWNER)
    created_by: Mapped[int] = _fk("users.id", ondelete="RESTRICT")
    name: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(ACCOUNT_TYPE)
    institution: Mapped[str | None] = mapped_column(String(120))
    last4: Mapped[str | None] = mapped_column(String(4))
    initial_balance_cents: Mapped[int] = mapped_column(BigInteger, server_default="0")
    initial_balance_date: Mapped[date] = mapped_column(Date)
    closing_day: Mapped[int | None] = mapped_column(SmallInteger)
    due_day: Mapped[int | None] = mapped_column(SmallInteger)
    active: Mapped[bool] = mapped_column(Boolean, server_default="true")
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    __table_args__ = (Index("ix_accounts_owner", "owner"),)


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = _pk()
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(CATEGORY_KIND)
    parent_id: Mapped[int | None] = _fk("categories.id", ondelete="RESTRICT", nullable=True)
    is_recurring_card_allowed: Mapped[bool] = mapped_column(Boolean, server_default="false")
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[int] = _pk()
    user_id: Mapped[int] = _fk("users.id", ondelete="RESTRICT")
    path: Mapped[str] = mapped_column(Text)
    mime: Mapped[str] = mapped_column(String(120))
    size: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = _created_at()

    __table_args__ = (Index("ix_attachments_sha256", "sha256"),)


class AiExtraction(Base):
    __tablename__ = "ai_extractions"

    id: Mapped[int] = _pk()
    user_id: Mapped[int] = _fk("users.id", ondelete="RESTRICT")
    attachment_id: Mapped[int | None] = _fk("attachments.id", ondelete="SET NULL", nullable=True)
    input_kind: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(80))
    prompt_version: Mapped[str] = mapped_column(String(40))
    raw_output_json: Mapped[Any | None] = mapped_column(JSONB)
    usage_tokens: Mapped[int | None] = mapped_column(Integer)
    est_cost_cents: Mapped[int | None] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(20))
    error_code: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = _created_at()


class Draft(Base):
    __tablename__ = "drafts"

    id: Mapped[int] = _pk()
    ai_extraction_id: Mapped[int] = _fk("ai_extractions.id", ondelete="RESTRICT")
    payload_json: Mapped[Any] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(DRAFT_STATUS, server_default="pending")
    resolved_by: Mapped[int | None] = _fk("users.id", ondelete="RESTRICT", nullable=True)
    resolved_at: Mapped[datetime | None] = _tstz()
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    __table_args__ = (Index("ix_drafts_ai_extraction_id", "ai_extraction_id"),)


class RecurringBill(Base):
    __tablename__ = "recurring_bills"

    id: Mapped[int] = _pk()
    owner: Mapped[str] = mapped_column(OWNER)
    name: Mapped[str] = mapped_column(String(120))
    amount_cents: Mapped[int] = mapped_column(BigInteger)
    due_day: Mapped[int] = mapped_column(SmallInteger)
    start_month: Mapped[date] = mapped_column(Date)  # primeiro dia do mês
    end_month: Mapped[date | None] = mapped_column(Date)  # primeiro dia do mês
    account_id: Mapped[int | None] = _fk("accounts.id", ondelete="RESTRICT", nullable=True)
    category_id: Mapped[int | None] = _fk("categories.id", ondelete="RESTRICT", nullable=True)
    payment_method: Mapped[str | None] = mapped_column(String(40))
    # Conta fixa gerida por uma dívida (parcelas): o gerador mensal a ignora.
    debt_id: Mapped[int | None] = _fk("debts.id", ondelete="RESTRICT", nullable=True)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    __table_args__ = (UniqueConstraint("debt_id"),)


class BillInstance(Base):
    __tablename__ = "bill_instances"

    id: Mapped[int] = _pk()
    recurring_bill_id: Mapped[int] = _fk("recurring_bills.id", ondelete="RESTRICT")
    month: Mapped[date] = mapped_column(Date)  # primeiro dia do mês
    due_date: Mapped[date] = mapped_column(Date)
    amount_cents: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(BILL_STATUS, server_default="open")
    paid_transaction_id: Mapped[int | None] = _fk(
        "transactions.id",
        ondelete="SET NULL",
        nullable=True,
        use_alter=True,
        name="fk_bill_instances_paid_transaction_id_transactions",
    )
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    __table_args__ = (
        UniqueConstraint("recurring_bill_id", "month"),
        Index("ix_bill_instances_due_date_status", "due_date", "status"),
    )


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = _pk()
    kind: Mapped[str] = mapped_column(TX_KIND)
    amount_cents: Mapped[int] = mapped_column(BigInteger)
    date: Mapped[date] = mapped_column(Date)
    description: Mapped[str] = mapped_column(Text)
    account_id: Mapped[int] = _fk("accounts.id", ondelete="RESTRICT")
    to_account_id: Mapped[int | None] = _fk("accounts.id", ondelete="RESTRICT", nullable=True)
    category_id: Mapped[int | None] = _fk("categories.id", ondelete="RESTRICT", nullable=True)
    owner: Mapped[str] = mapped_column(OWNER)
    created_by: Mapped[int] = _fk("users.id", ondelete="RESTRICT")
    status: Mapped[str] = mapped_column(TX_STATUS, server_default="confirmed")
    source: Mapped[str] = mapped_column(TX_SOURCE)
    attachment_id: Mapped[int | None] = _fk("attachments.id", ondelete="SET NULL", nullable=True)
    ai_extraction_id: Mapped[int | None] = _fk(
        "ai_extractions.id", ondelete="SET NULL", nullable=True
    )
    dedupe_hash: Mapped[str | None] = mapped_column(String(64))
    bill_instance_id: Mapped[int | None] = _fk(
        "bill_instances.id", ondelete="SET NULL", nullable=True
    )
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    __table_args__ = (
        CheckConstraint("amount_cents > 0", name="amount_positive"),
        Index("ix_transactions_date", "date"),
        Index("ix_transactions_account_id_date", "account_id", "date"),
        Index("ix_transactions_owner", "owner"),
        Index("ix_transactions_dedupe_hash", "dedupe_hash"),
    )


class Debt(Base):
    __tablename__ = "debts"

    id: Mapped[int] = _pk()
    owner: Mapped[str] = mapped_column(OWNER)
    name: Mapped[str] = mapped_column(String(120))
    principal_cents: Mapped[int] = mapped_column(BigInteger)
    monthly_rate: Mapped[Decimal] = mapped_column(Numeric(8, 6))
    installments: Mapped[int] = mapped_column(Integer)
    installment_cents: Mapped[int] = mapped_column(BigInteger)
    start_date: Mapped[date] = mapped_column(Date)
    current_balance_cents: Mapped[int] = mapped_column(BigInteger)
    paid_before_app_cents: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()


class DebtInstallment(Base):
    __tablename__ = "debt_installments"

    id: Mapped[int] = _pk()
    debt_id: Mapped[int] = _fk("debts.id", ondelete="RESTRICT")
    number: Mapped[int] = mapped_column(Integer)
    due_date: Mapped[date] = mapped_column(Date)
    face_cents: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(INSTALLMENT_STATUS, server_default="open")
    paid_cents: Mapped[int | None] = mapped_column(BigInteger)
    paid_on: Mapped[date | None] = mapped_column(Date)
    transaction_id: Mapped[int | None] = _fk("transactions.id", ondelete="SET NULL", nullable=True)
    bill_instance_id: Mapped[int] = _fk("bill_instances.id", ondelete="RESTRICT")
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    __table_args__ = (
        UniqueConstraint("debt_id", "number"),
        UniqueConstraint("bill_instance_id"),
        CheckConstraint("face_cents > 0", name="face_positive"),
        Index("ix_debt_installments_transaction_id", "transaction_id"),
    )


class Goal(Base):
    __tablename__ = "goals"

    id: Mapped[int] = _pk()
    owner: Mapped[str] = mapped_column(OWNER)
    type: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(120))
    target_cents: Mapped[int] = mapped_column(BigInteger)
    period: Mapped[str | None] = mapped_column(String(20))
    levels_json: Mapped[Any | None] = mapped_column(JSONB)
    due_date: Mapped[date | None] = mapped_column(Date)
    linked_account_id: Mapped[int | None] = _fk("accounts.id", ondelete="SET NULL", nullable=True)
    linked_category_id: Mapped[int | None] = _fk(
        "categories.id", ondelete="SET NULL", nullable=True
    )
    active: Mapped[bool] = mapped_column(Boolean, server_default="true")
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()


class GoalEntry(Base):
    __tablename__ = "goal_entries"

    id: Mapped[int] = _pk()
    goal_id: Mapped[int] = _fk("goals.id", ondelete="CASCADE")
    amount_cents: Mapped[int] = mapped_column(BigInteger)
    date: Mapped[date] = mapped_column(Date)
    transaction_id: Mapped[int | None] = _fk("transactions.id", ondelete="SET NULL", nullable=True)
    created_at: Mapped[datetime] = _created_at()

    __table_args__ = (Index("ix_goal_entries_goal_id", "goal_id"),)


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id: Mapped[int] = _pk()
    user_id: Mapped[int] = _fk("users.id", ondelete="CASCADE")
    endpoint: Mapped[str] = mapped_column(Text)
    keys_json: Mapped[Any] = mapped_column(JSONB)
    device_label: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = _created_at()
    last_ok_at: Mapped[datetime | None] = _tstz()

    __table_args__ = (
        Index("ix_push_subscriptions_endpoint", "endpoint", unique=True),
        Index("ix_push_subscriptions_user_id", "user_id"),
    )


class NotificationLog(Base):
    __tablename__ = "notification_log"

    id: Mapped[int] = _pk()
    user_id: Mapped[int] = _fk("users.id", ondelete="CASCADE")
    channel: Mapped[str] = mapped_column(String(20))
    type: Mapped[str] = mapped_column(String(40))
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    status: Mapped[str] = mapped_column(String(20))
    error: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (Index("ix_notification_log_user_id_sent_at", "user_id", "sent_at"),)


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value_json: Mapped[Any] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = _pk()
    user_id: Mapped[int | None] = _fk("users.id", ondelete="SET NULL", nullable=True)
    entity: Mapped[str] = mapped_column(String(60))
    entity_id: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(20))
    before_json: Mapped[Any | None] = mapped_column(JSONB)
    after_json: Mapped[Any | None] = mapped_column(JSONB)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (Index("ix_audit_log_entity_entity_id", "entity", "entity_id"),)
