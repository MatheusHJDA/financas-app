from sqlalchemy import BigInteger, Integer

from finance_api.db import models  # noqa: F401
from finance_api.db.base import Base

EXPECTED_TABLES = {
    "users",
    "sessions",
    "accounts",
    "categories",
    "transactions",
    "ai_extractions",
    "drafts",
    "attachments",
    "recurring_bills",
    "bill_instances",
    "debts",
    "goals",
    "goal_entries",
    "push_subscriptions",
    "notification_log",
    "settings",
    "audit_log",
}


def test_all_17_tables_exist() -> None:
    assert len(EXPECTED_TABLES) == 17
    assert set(Base.metadata.tables) == EXPECTED_TABLES


def test_money_columns_are_integer_cents() -> None:
    money = [
        col
        for table in Base.metadata.tables.values()
        for col in table.columns
        if "cents" in col.name
    ]
    assert money, "nenhuma coluna de dinheiro encontrada"
    for col in money:
        assert col.name.endswith("_cents"), col.name
        assert isinstance(col.type, BigInteger | Integer), col.name


def test_ids_are_bigint_identity_except_settings() -> None:
    for name, table in Base.metadata.tables.items():
        if name == "settings":
            assert [c.name for c in table.primary_key.columns] == ["key"]
            continue
        pk = table.c.id
        assert isinstance(pk.type, BigInteger), name
        assert pk.identity is not None, name


def test_required_indexes_exist() -> None:
    def index_cols(table: str) -> set[tuple[str, ...]]:
        return {tuple(c.name for c in ix.columns) for ix in Base.metadata.tables[table].indexes}

    tx = index_cols("transactions")
    assert {("date",), ("account_id", "date"), ("owner",), ("dedupe_hash",)} <= tx
    assert ("due_date", "status") in index_cols("bill_instances")
    assert ("entity", "entity_id") in index_cols("audit_log")
    push = Base.metadata.tables["push_subscriptions"]
    assert any(ix.unique and [c.name for c in ix.columns] == ["endpoint"] for ix in push.indexes)
    bills = Base.metadata.tables["bill_instances"]
    uniques = {
        tuple(c.name for c in con.columns)
        for con in bills.constraints
        if con.__class__.__name__ == "UniqueConstraint"
    }
    assert ("recurring_bill_id", "month") in uniques
