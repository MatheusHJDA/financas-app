import io
import re
from pathlib import Path

import pytest
from alembic.config import Config

from alembic import command
from finance_api.db import models  # noqa: F401
from finance_api.db.base import Base

API_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def offline_sql() -> str:
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "alembic"))
    buffer = io.StringIO()
    cfg.output_buffer = buffer
    command.upgrade(cfg, "head", sql=True)
    return buffer.getvalue()


def test_creates_every_table(offline_sql: str) -> None:
    for table in Base.metadata.tables:
        assert re.search(rf"CREATE TABLE {table} \(", offline_sql), table


def test_every_model_column_is_in_migration(offline_sql: str) -> None:
    for name, table in Base.metadata.tables.items():
        block = offline_sql.split(f"CREATE TABLE {name} (", 1)[1].split("\n);", 1)[0]
        for col in table.columns:
            in_create = re.search(rf"^\s+{col.name} ", block, re.MULTILINE)
            # colunas de migrações posteriores aparecem em ALTER TABLE ... ADD COLUMN
            in_alter = re.search(rf"ALTER TABLE {name} ADD COLUMN {col.name} ", offline_sql)
            assert in_create or in_alter, f"{name}.{col.name}"


def test_enums_created_once(offline_sql: str) -> None:
    for enum in (
        "user_role",
        "owner",
        "account_type",
        "category_kind",
        "tx_kind",
        "tx_status",
        "tx_source",
        "draft_status",
        "bill_status",
        "installment_status",
        "login_purpose",
        "access_code_kind",
    ):
        assert offline_sql.count(f"CREATE TYPE {enum} AS ENUM") == 1, enum


def test_indexes_present(offline_sql: str) -> None:
    for fragment in (
        "ix_transactions_date",
        "ix_transactions_account_id_date",
        "ix_transactions_owner",
        "ix_transactions_dedupe_hash",
        "ix_bill_instances_due_date_status",
        "ix_audit_log_entity_entity_id",
        "CREATE UNIQUE INDEX ix_push_subscriptions_endpoint",
        "uq_bill_instances_recurring_bill_id",
    ):
        assert fragment in offline_sql, fragment


def test_downgrade_0002_turns_prepaid_into_paid() -> None:
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "alembic"))
    buffer = io.StringIO()
    cfg.output_buffer = buffer
    command.downgrade(cfg, "0002_debt_installments:0001_initial", sql=True)
    sql = buffer.getvalue()
    update = sql.index("UPDATE bill_instances SET status = 'paid' WHERE status = 'prepaid'")
    assert update < sql.index("DROP TABLE debt_installments")
