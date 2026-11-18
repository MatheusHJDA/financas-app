"""Login em duas etapas: chaves de acesso, tentativas, códigos, falhas e trava da conta.

Revision ID: 0003_login_dois_fatores
Revises: 0002_debt_installments
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0003_login_dois_fatores"
down_revision = "0002_debt_installments"
branch_labels = None
depends_on = None


def _tstz(name: str, *, nullable: bool = True) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def _created(name: str = "created_at") -> sa.Column:
    return sa.Column(
        name, sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )


def upgrade() -> None:
    op.execute("CREATE TYPE login_purpose AS ENUM ('login', 'register')")
    op.execute("CREATE TYPE access_code_kind AS ENUM ('release', 'recovery')")

    op.add_column("users", _tstz("locked_at"))
    op.add_column("users", sa.Column("webauthn_user_id", sa.LargeBinary()))
    # A trava passa a ser sem prazo (`locked_at`); o prazo antigo deixa de valer.
    op.execute("UPDATE users SET locked_until = NULL")

    op.add_column(
        "sessions",
        sa.Column("two_factor", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("sessions", _tstz("max_expires_at"))

    op.create_table(
        "passkeys",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("credential_id", sa.LargeBinary(), nullable=False, unique=True),
        sa.Column("public_key", sa.LargeBinary(), nullable=False),
        sa.Column("sign_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("device_label", sa.String(120), nullable=False),
        _created(),
        _tstz("last_used_at"),
    )
    op.create_index("ix_passkeys_user_id", "passkeys", ["user_id"])

    op.create_table(
        "login_attempts",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column(
            "purpose",
            pg.ENUM("login", "register", name="login_purpose", create_type=False),
            nullable=False,
        ),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE")),
        sa.Column("pin_ok", sa.Boolean(), nullable=False),
        sa.Column("challenge", sa.LargeBinary(), nullable=False),
        sa.Column("code_hash", sa.String(64)),
        sa.Column("device_label", sa.String(120), nullable=False),
        sa.Column("source", sa.String(64), nullable=False),
        _tstz("expires_at", nullable=False),
        _tstz("used_at"),
        _created(),
    )

    op.create_table(
        "access_codes",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "kind",
            pg.ENUM("release", "recovery", name="access_code_kind", create_type=False),
            nullable=False,
        ),
        sa.Column("code_hash", sa.String(64), nullable=False),
        _tstz("expires_at"),
        _tstz("used_at"),
        sa.Column("created_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        _created(),
    )
    op.create_index("ix_access_codes_user_id_code_hash", "access_codes", ["user_id", "code_hash"])

    op.create_table(
        "auth_failures",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("source", sa.String(64), nullable=False),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE")),
        _created("at"),
    )
    op.create_index("ix_auth_failures_source_at", "auth_failures", ["source", "at"])
    op.create_index("ix_auth_failures_user_id_at", "auth_failures", ["user_id", "at"])


def downgrade() -> None:
    """Remove tabelas, colunas e tipos novos. Quem estava travado deixa de estar."""
    op.drop_index("ix_auth_failures_user_id_at", table_name="auth_failures")
    op.drop_index("ix_auth_failures_source_at", table_name="auth_failures")
    op.drop_table("auth_failures")
    op.drop_index("ix_access_codes_user_id_code_hash", table_name="access_codes")
    op.drop_table("access_codes")
    op.drop_table("login_attempts")
    op.drop_index("ix_passkeys_user_id", table_name="passkeys")
    op.drop_table("passkeys")
    op.execute("DROP TYPE access_code_kind")
    op.execute("DROP TYPE login_purpose")
    op.drop_column("sessions", "max_expires_at")
    op.drop_column("sessions", "two_factor")
    op.drop_column("users", "webauthn_user_id")
    op.drop_column("users", "locked_at")
