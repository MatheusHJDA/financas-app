"""Parcelas do empréstimo: debt_installments, conta fixa da dívida e estado `prepaid`.

Revision ID: 0002_debt_installments
Revises: 0001_initial
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0002_debt_installments"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Postgres >= 12 (usamos 16) permite ADD VALUE dentro de transação, desde que o valor novo
    # não seja usado nesta mesma transação (aqui não é). `autocommit_block` não serve: o harness
    # de testes entrega a conexão já dentro de uma transação externa.
    op.execute("ALTER TYPE bill_status ADD VALUE IF NOT EXISTS 'prepaid'")
    op.execute("CREATE TYPE installment_status AS ENUM ('open', 'paid', 'prepaid')")

    op.add_column(
        "debts",
        sa.Column(
            "paid_before_app_cents",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "recurring_bills",
        sa.Column(
            "debt_id", sa.BigInteger(), sa.ForeignKey("debts.id", ondelete="RESTRICT")
        ),
    )
    op.create_unique_constraint("uq_recurring_bills_debt_id", "recurring_bills", ["debt_id"])

    op.create_table(
        "debt_installments",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "debt_id", sa.BigInteger(), sa.ForeignKey("debts.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("face_cents", sa.BigInteger(), nullable=False),
        sa.Column(
            "status",
            pg.ENUM("open", "paid", "prepaid", name="installment_status", create_type=False),
            nullable=False,
            server_default=sa.text("'open'"),
        ),
        sa.Column("paid_cents", sa.BigInteger()),
        sa.Column("paid_on", sa.Date()),
        sa.Column(
            "transaction_id",
            sa.BigInteger(),
            sa.ForeignKey("transactions.id", ondelete="SET NULL"),
        ),
        sa.Column(
            "bill_instance_id",
            sa.BigInteger(),
            sa.ForeignKey("bill_instances.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.UniqueConstraint("debt_id", "number"),
        sa.UniqueConstraint("bill_instance_id"),
        sa.CheckConstraint("face_cents > 0", name="ck_debt_installments_face_positive"),
    )
    op.create_index(
        "ix_debt_installments_transaction_id", "debt_installments", ["transaction_id"]
    )


def downgrade() -> None:
    """Remove tabela, colunas e o tipo novo.

    O valor 'prepaid' de `bill_status` NÃO volta: o Postgres não remove valores de enum.
    Ele permanece no tipo, inofensivo, mas instâncias com esse estado devem ser tratadas antes.
    """
    # 'prepaid' não existe no app antigo: vira 'paid' (o valor do enum fica, inofensivo).
    op.execute("UPDATE bill_instances SET status = 'paid' WHERE status = 'prepaid'")
    op.drop_index("ix_debt_installments_transaction_id", table_name="debt_installments")
    op.drop_table("debt_installments")
    op.execute("DROP TYPE installment_status")
    op.drop_constraint("uq_recurring_bills_debt_id", "recurring_bills", type_="unique")
    op.drop_column("recurring_bills", "debt_id")
    op.drop_column("debts", "paid_before_app_cents")
