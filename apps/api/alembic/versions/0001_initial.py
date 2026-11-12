"""Schema inicial completo (ORQUESTRACAO.md, seção 7).

Revision ID: 0001_initial
Revises:
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

# Tipos enum nativos: criados uma única vez (aqui) e só referenciados nas tabelas.
ENUM_VALUES = {
    "user_role": ("admin", "member"),
    "owner": ("RUTH", "MATHEUS", "AMBOS"),
    "account_type": ("checking", "savings", "cash", "meal_voucher", "credit_card", "loan"),
    "category_kind": ("income", "expense"),
    "tx_kind": ("income", "expense", "transfer"),
    "tx_status": ("confirmed",),
    "tx_source": ("chat", "manual", "import"),
    "draft_status": ("pending", "confirmed", "discarded"),
    "bill_status": ("open", "paid"),
}


def _enum(name: str) -> pg.ENUM:
    return pg.ENUM(*ENUM_VALUES[name], name=name, create_type=False)


def _id() -> sa.Column:
    return sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True)


def _bigint(name: str, *, nullable: bool = False, default: str | None = None) -> sa.Column:
    return sa.Column(
        name,
        sa.BigInteger(),
        nullable=nullable,
        server_default=sa.text(default) if default is not None else None,
    )


def _fk(name: str, target: str, ondelete: str, *, nullable: bool = False) -> sa.Column:
    return sa.Column(
        name, sa.BigInteger(), sa.ForeignKey(target, ondelete=ondelete), nullable=nullable
    )


def _ts(name: str, *, nullable: bool = True, now: bool = False) -> sa.Column:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        nullable=nullable,
        server_default=sa.text("now()") if now else None,
    )


def _created() -> sa.Column:
    return _ts("created_at", nullable=False, now=True)


def _updated() -> sa.Column:
    return _ts("updated_at", nullable=False, now=True)


def upgrade() -> None:
    for name, values in ENUM_VALUES.items():
        labels = ", ".join(f"'{v}'" for v in values)
        op.execute(f"CREATE TYPE {name} AS ENUM ({labels})")

    op.create_table(
        "users",
        _id(),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("role", _enum("user_role"), nullable=False),
        sa.Column("pin_hash", sa.Text(), nullable=False),
        sa.Column("failed_attempts", sa.Integer(), nullable=False, server_default=sa.text("0")),
        _ts("locked_until"),
        _created(),
        _updated(),
        sa.UniqueConstraint("name"),
    )

    op.create_table(
        "sessions",
        _id(),
        sa.Column("token_hash", sa.String(64), nullable=False),
        _fk("user_id", "users.id", "CASCADE"),
        sa.Column("device_label", sa.String(120), nullable=False),
        _ts("expires_at", nullable=False),
        _ts("revoked_at"),
        _created(),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])

    op.create_table(
        "accounts",
        _id(),
        sa.Column("owner", _enum("owner"), nullable=False),
        _fk("created_by", "users.id", "RESTRICT"),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("type", _enum("account_type"), nullable=False),
        sa.Column("institution", sa.String(120)),
        sa.Column("last4", sa.String(4)),
        _bigint("initial_balance_cents", default="0"),
        sa.Column("initial_balance_date", sa.Date(), nullable=False),
        sa.Column("closing_day", sa.SmallInteger()),
        sa.Column("due_day", sa.SmallInteger()),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        _created(),
        _updated(),
    )
    op.create_index("ix_accounts_owner", "accounts", ["owner"])

    op.create_table(
        "categories",
        _id(),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", _enum("category_kind"), nullable=False),
        _fk("parent_id", "categories.id", "RESTRICT", nullable=True),
        sa.Column(
            "is_recurring_card_allowed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        _created(),
        _updated(),
    )

    op.create_table(
        "attachments",
        _id(),
        _fk("user_id", "users.id", "RESTRICT"),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("mime", sa.String(120), nullable=False),
        _bigint("size"),
        sa.Column("sha256", sa.String(64), nullable=False),
        _created(),
    )
    op.create_index("ix_attachments_sha256", "attachments", ["sha256"])

    op.create_table(
        "ai_extractions",
        _id(),
        _fk("user_id", "users.id", "RESTRICT"),
        _fk("attachment_id", "attachments.id", "SET NULL", nullable=True),
        sa.Column("input_kind", sa.String(20), nullable=False),
        sa.Column("model", sa.String(80), nullable=False),
        sa.Column("prompt_version", sa.String(40), nullable=False),
        sa.Column("raw_output_json", pg.JSONB()),
        sa.Column("usage_tokens", sa.Integer()),
        _bigint("est_cost_cents", nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("error_code", sa.String(80)),
        _created(),
    )

    op.create_table(
        "drafts",
        _id(),
        _fk("ai_extraction_id", "ai_extractions.id", "RESTRICT"),
        sa.Column("payload_json", pg.JSONB(), nullable=False),
        sa.Column(
            "status", _enum("draft_status"), nullable=False, server_default=sa.text("'pending'")
        ),
        _fk("resolved_by", "users.id", "RESTRICT", nullable=True),
        _ts("resolved_at"),
        _created(),
        _updated(),
    )
    op.create_index("ix_drafts_ai_extraction_id", "drafts", ["ai_extraction_id"])

    op.create_table(
        "recurring_bills",
        _id(),
        sa.Column("owner", _enum("owner"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        _bigint("amount_cents"),
        sa.Column("due_day", sa.SmallInteger(), nullable=False),
        sa.Column("start_month", sa.Date(), nullable=False),
        sa.Column("end_month", sa.Date()),
        _fk("account_id", "accounts.id", "RESTRICT", nullable=True),
        _fk("category_id", "categories.id", "RESTRICT", nullable=True),
        sa.Column("payment_method", sa.String(40)),
        _created(),
        _updated(),
    )

    # bill_instances.paid_transaction_id -> transactions.id é adicionada depois (referência circular).
    op.create_table(
        "bill_instances",
        _id(),
        _fk("recurring_bill_id", "recurring_bills.id", "RESTRICT"),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        _bigint("amount_cents"),
        sa.Column(
            "status", _enum("bill_status"), nullable=False, server_default=sa.text("'open'")
        ),
        _bigint("paid_transaction_id", nullable=True),
        _created(),
        _updated(),
        sa.UniqueConstraint("recurring_bill_id", "month"),
    )
    op.create_index("ix_bill_instances_due_date_status", "bill_instances", ["due_date", "status"])

    op.create_table(
        "transactions",
        _id(),
        sa.Column("kind", _enum("tx_kind"), nullable=False),
        _bigint("amount_cents"),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        _fk("account_id", "accounts.id", "RESTRICT"),
        _fk("to_account_id", "accounts.id", "RESTRICT", nullable=True),
        _fk("category_id", "categories.id", "RESTRICT", nullable=True),
        sa.Column("owner", _enum("owner"), nullable=False),
        _fk("created_by", "users.id", "RESTRICT"),
        sa.Column(
            "status", _enum("tx_status"), nullable=False, server_default=sa.text("'confirmed'")
        ),
        sa.Column("source", _enum("tx_source"), nullable=False),
        _fk("attachment_id", "attachments.id", "SET NULL", nullable=True),
        _fk("ai_extraction_id", "ai_extractions.id", "SET NULL", nullable=True),
        sa.Column("dedupe_hash", sa.String(64)),
        _fk("bill_instance_id", "bill_instances.id", "SET NULL", nullable=True),
        _created(),
        _updated(),
        sa.CheckConstraint("amount_cents > 0", name="amount_positive"),
    )
    op.create_index("ix_transactions_date", "transactions", ["date"])
    op.create_index("ix_transactions_account_id_date", "transactions", ["account_id", "date"])
    op.create_index("ix_transactions_owner", "transactions", ["owner"])
    op.create_index("ix_transactions_dedupe_hash", "transactions", ["dedupe_hash"])

    op.create_foreign_key(
        "fk_bill_instances_paid_transaction_id_transactions",
        "bill_instances",
        "transactions",
        ["paid_transaction_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "debts",
        _id(),
        sa.Column("owner", _enum("owner"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        _bigint("principal_cents"),
        sa.Column("monthly_rate", sa.Numeric(8, 6), nullable=False),
        sa.Column("installments", sa.Integer(), nullable=False),
        _bigint("installment_cents"),
        sa.Column("start_date", sa.Date(), nullable=False),
        _bigint("current_balance_cents"),
        _created(),
        _updated(),
    )

    op.create_table(
        "goals",
        _id(),
        sa.Column("owner", _enum("owner"), nullable=False),
        sa.Column("type", sa.String(40), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        _bigint("target_cents"),
        sa.Column("period", sa.String(20)),
        sa.Column("levels_json", pg.JSONB()),
        sa.Column("due_date", sa.Date()),
        _fk("linked_account_id", "accounts.id", "SET NULL", nullable=True),
        _fk("linked_category_id", "categories.id", "SET NULL", nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        _created(),
        _updated(),
    )

    op.create_table(
        "goal_entries",
        _id(),
        _fk("goal_id", "goals.id", "CASCADE"),
        _bigint("amount_cents"),
        sa.Column("date", sa.Date(), nullable=False),
        _fk("transaction_id", "transactions.id", "SET NULL", nullable=True),
        _created(),
    )
    op.create_index("ix_goal_entries_goal_id", "goal_entries", ["goal_id"])

    op.create_table(
        "push_subscriptions",
        _id(),
        _fk("user_id", "users.id", "CASCADE"),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("keys_json", pg.JSONB(), nullable=False),
        sa.Column("device_label", sa.String(120)),
        _created(),
        _ts("last_ok_at"),
    )
    op.create_index(
        "ix_push_subscriptions_endpoint", "push_subscriptions", ["endpoint"], unique=True
    )
    op.create_index("ix_push_subscriptions_user_id", "push_subscriptions", ["user_id"])

    op.create_table(
        "notification_log",
        _id(),
        _fk("user_id", "users.id", "CASCADE"),
        sa.Column("channel", sa.String(20), nullable=False),
        sa.Column("type", sa.String(40), nullable=False),
        _ts("sent_at", nullable=False, now=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("error", sa.Text()),
    )
    op.create_index(
        "ix_notification_log_user_id_sent_at", "notification_log", ["user_id", "sent_at"]
    )

    op.create_table(
        "settings",
        sa.Column("key", sa.Text(), primary_key=True),
        sa.Column("value_json", pg.JSONB(), nullable=False),
        _created(),
        _updated(),
    )

    op.create_table(
        "audit_log",
        _id(),
        _fk("user_id", "users.id", "SET NULL", nullable=True),
        sa.Column("entity", sa.String(60), nullable=False),
        sa.Column("entity_id", sa.String(64), nullable=False),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("before_json", pg.JSONB()),
        sa.Column("after_json", pg.JSONB()),
        _ts("at", nullable=False, now=True),
    )
    op.create_index("ix_audit_log_entity_entity_id", "audit_log", ["entity", "entity_id"])


def downgrade() -> None:
    op.drop_constraint(
        "fk_bill_instances_paid_transaction_id_transactions", "bill_instances", type_="foreignkey"
    )
    for table in (
        "audit_log",
        "settings",
        "notification_log",
        "push_subscriptions",
        "goal_entries",
        "goals",
        "debts",
        "transactions",
        "bill_instances",
        "recurring_bills",
        "drafts",
        "ai_extractions",
        "attachments",
        "categories",
        "accounts",
        "sessions",
        "users",
    ):
        op.drop_table(table)
    for name in ENUM_VALUES:
        op.execute(f"DROP TYPE {name}")
