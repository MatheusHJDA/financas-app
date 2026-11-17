from datetime import date

from sqlalchemy import BigInteger, Integer

from finance_api.db import models  # noqa: F401
from finance_api.db.base import Base
from finance_api.db.models import BillInstance, Debt, DebtInstallment, RecurringBill

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
    "debt_installments",
    "goals",
    "goal_entries",
    "push_subscriptions",
    "notification_log",
    "settings",
    "audit_log",
}


def test_all_18_tables_exist() -> None:
    assert len(EXPECTED_TABLES) == 18
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


def _make_debt_bill_instance(db, status: str = "open") -> tuple[Debt, BillInstance]:
    debt = Debt(
        owner="AMBOS",
        name="Empréstimo",
        principal_cents=1000000,
        monthly_rate="0.02",
        installments=12,
        installment_cents=100000,
        start_date=date(2026, 12, 1),
        current_balance_cents=1000000,
    )
    db.add(debt)
    db.flush()
    bill = RecurringBill(
        owner="AMBOS",
        name="Empréstimo",
        amount_cents=100000,
        due_day=5,
        start_month=date(2026, 12, 1),
        debt_id=debt.id,
    )
    db.add(bill)
    db.flush()
    inst = BillInstance(
        recurring_bill_id=bill.id,
        month=date(2026, 12, 1),
        due_date=date(2026, 12, 5),
        amount_cents=100000,
        status=status,
    )
    db.add(inst)
    db.flush()
    return debt, inst


def test_debt_installment_roundtrip(db) -> None:
    debt, inst = _make_debt_bill_instance(db)
    db.add(
        DebtInstallment(
            debt_id=debt.id,
            number=1,
            due_date=date(2026, 12, 5),
            face_cents=100000,
            bill_instance_id=inst.id,
        )
    )
    db.flush()
    db.expire_all()
    row = db.query(DebtInstallment).one()
    assert row.status == "open"
    assert row.paid_cents is None
    assert row.paid_on is None
    assert row.transaction_id is None
    assert db.get(Debt, debt.id).paid_before_app_cents == 0


def test_bill_status_accepts_prepaid(db) -> None:
    _, inst = _make_debt_bill_instance(db, status="prepaid")
    db.expire_all()
    assert db.get(BillInstance, inst.id).status == "prepaid"
