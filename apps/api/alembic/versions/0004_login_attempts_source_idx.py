"""Índice das tentativas de entrada por origem (limite de inícios por origem).

Revision ID: 0004_login_attempts_source_idx
Revises: 0003_login_dois_fatores
"""

from alembic import op

revision = "0004_login_attempts_source_idx"
down_revision = "0003_login_dois_fatores"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_login_attempts_source_expires_at", "login_attempts", ["source", "expires_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_login_attempts_source_expires_at", table_name="login_attempts")
