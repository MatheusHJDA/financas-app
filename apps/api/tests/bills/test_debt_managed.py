"""Contas fixas geridas pelo empréstimo: pagamento pela tela de contas, adiantadas e travas."""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from finance_api.db.models import (
    Account,
    BillInstance,
    Category,
    Debt,
    DebtInstallment,
    RecurringBill,
    Transaction,
)
from finance_api.debts.installments import InstallmentSpec, set_schedule
from finance_api.notifications.service import _open_bills_due

FACE = 141757
DUES = [date(2026, 12, 18), date(2027, 1, 18), date(2027, 12, 20)]


@pytest.fixture
def loan(db, users):
    account = Account(
        owner="AMBOS",
        created_by=users["matheus"].id,
        name="Nubank (Matheus)",
        type="checking",
        initial_balance_cents=0,
        initial_balance_date=date(2026, 1, 1),
    )
    category = Category(name="Empréstimo", kind="expense")
    debt = Debt(
        owner="AMBOS",
        name="Empréstimo",
        principal_cents=2200000,
        monthly_rate=Decimal("0.0345"),
        installments=24,
        installment_cents=136282,
        start_date=date(2025, 12, 18),
        current_balance_cents=2200000,
    )
    db.add_all([account, category, debt])
    db.flush()
    specs = [InstallmentSpec(n, due, FACE) for n, due in enumerate(DUES, start=1)]
    set_schedule(db, users["matheus"], debt, specs, 818799, account.id, category.id)
    db.flush()
    bill = db.scalar(select(RecurringBill).where(RecurringBill.debt_id == debt.id))
    parcels = list(
        db.scalars(
            select(DebtInstallment)
            .where(DebtInstallment.debt_id == debt.id)
            .order_by(DebtInstallment.number)
        )
    )
    return {"debt": debt, "account": account, "bill": bill, "parcels": parcels}


def _pay(client, inst_id, **body):
    return client.post(f"/api/bill-instances/{inst_id}/pay", json=body)


def _prepay_last(db, users, client_as, loan):
    last = loan["parcels"][2]
    resp = _pay(
        client_as(users["matheus"]),
        last.bill_instance_id,
        amount_cents=100000,
        account_id=loan["account"].id,
        date="2026-11-17",
    )
    assert resp.status_code == 200
    return db.get(BillInstance, last.bill_instance_id)


def test_pay_from_bills_requires_amount(users, client_as, loan):
    client = client_as(users["matheus"])
    inst_id = loan["parcels"][0].bill_instance_id
    assert _pay(client, inst_id).status_code == 422
    assert _pay(client, inst_id, amount_cents=FACE).status_code == 422
    assert _pay(client, inst_id, account_id=loan["account"].id).status_code == 422


def test_pay_from_bills_current_month_is_paid(db, users, client_as, loan):
    first = loan["parcels"][0]
    resp = _pay(
        client_as(users["matheus"]),
        first.bill_instance_id,
        amount_cents=FACE,
        account_id=loan["account"].id,
        date="2026-12-18",
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "paid" and body["debt_id"] == loan["debt"].id
    db.refresh(first)
    assert first.status == "paid" and first.paid_cents == FACE
    tx = db.get(Transaction, body["paid_transaction_id"])
    assert tx.amount_cents == FACE and tx.date == date(2026, 12, 18)
    assert loan["debt"].current_balance_cents == 2 * FACE


def test_pay_from_bills_future_month_is_prepaid(db, users, client_as, loan):
    inst = _prepay_last(db, users, client_as, loan)
    assert inst.status == "prepaid"
    last = loan["parcels"][2]
    db.refresh(last)
    assert last.status == "prepaid" and last.paid_cents == 100000
    assert last.paid_on == date(2026, 11, 17)


def test_pay_from_bills_with_existing_transaction(db, users, client_as, loan):
    account = loan["account"]
    tx = Transaction(
        kind="expense",
        amount_cents=120000,
        date=date(2026, 11, 17),
        description="Pix empréstimo",
        account_id=account.id,
        owner="AMBOS",
        created_by=users["matheus"].id,
        source="manual",
    )
    db.add(tx)
    db.flush()
    second = loan["parcels"][1]
    client = client_as(users["matheus"])
    resp = _pay(client, second.bill_instance_id, transaction_id=tx.id)
    assert resp.status_code == 200
    assert resp.json()["status"] == "prepaid" and resp.json()["paid_transaction_id"] == tx.id
    db.refresh(second)
    assert second.status == "prepaid" and second.paid_cents == 120000
    assert second.paid_on == date(2026, 11, 17) and second.transaction_id == tx.id
    assert loan["debt"].current_balance_cents == 2 * FACE
    # o mesmo lançamento não paga outra parcela
    other = loan["parcels"][0].bill_instance_id
    assert _pay(client, other, transaction_id=tx.id).status_code == 409


def test_prepaid_instance_pay_conflict(db, users, client_as, loan):
    inst = _prepay_last(db, users, client_as, loan)
    resp = _pay(
        client_as(users["matheus"]),
        inst.id,
        amount_cents=FACE,
        account_id=loan["account"].id,
        date="2026-12-20",
    )
    assert resp.status_code == 409


def test_cannot_edit_or_delete_debt_bill(users, client_as, loan):
    client = client_as(users["matheus"])
    url = f"/api/recurring-bills/{loan['bill'].id}"
    msg = "Esta conta é do empréstimo; altere pela tela do empréstimo."
    resp = client.patch(url, json={"name": "Outro"})
    assert resp.status_code == 409 and resp.json()["detail"] == msg
    resp = client.delete(url)
    assert resp.status_code == 409 and resp.json()["detail"] == msg


def test_bill_outputs_expose_debt_id(users, client_as, loan):
    client = client_as(users["matheus"])
    bills = client.get("/api/recurring-bills").json()["items"]
    assert {b["id"]: b["debt_id"] for b in bills}[loan["bill"].id] == loan["debt"].id
    insts = client.get(
        "/api/bill-instances", params={"date_from": "2026-12-01", "date_to": "2027-12-31"}
    ).json()["items"]
    mine = [i for i in insts if i["recurring_bill_id"] == loan["bill"].id]
    assert len(mine) == 3 and all(i["debt_id"] == loan["debt"].id for i in mine)


def test_list_open_excludes_prepaid(db, users, client_as, loan):
    inst = _prepay_last(db, users, client_as, loan)
    client = client_as(users["matheus"])
    params = {"date_from": "2026-12-01", "date_to": "2027-12-31"}
    url = "/api/bill-instances"
    open_items = client.get(url, params={**params, "status": "open"}).json()["items"]
    assert inst.id not in {i["id"] for i in open_items}
    all_items = {i["id"]: i for i in client.get(url, params=params).json()["items"]}
    assert all_items[inst.id]["status"] == "prepaid"
    prepaid = client.get("/api/bill-instances", params={**params, "status": "prepaid"}).json()
    assert [i["id"] for i in prepaid["items"]] == [inst.id]


def test_overview_and_report_ignore_prepaid(db, users, client_as, loan, monkeypatch):
    # a 1ª parcela (18/12) adiantada em 17/11; "hoje" = 10/12, dentro da janela de próximas contas
    first = loan["parcels"][0]
    resp = _pay(
        client_as(users["matheus"]),
        first.bill_instance_id,
        amount_cents=FACE,
        account_id=loan["account"].id,
        date="2026-11-17",
    )
    assert resp.json()["status"] == "prepaid"
    _prepay_last(db, users, client_as, loan)
    monkeypatch.setattr("finance_api.overview.router.today_sao_paulo", lambda: date(2026, 12, 10))
    client = client_as(users["matheus"])
    overview = client.get("/api/overview").json()
    listed = {b["id"] for b in overview["upcoming_bills"] + overview["overdue_bills"]}
    assert first.bill_instance_id not in listed

    report = client.get("/api/reports/month", params={"month": "2027-12"}).json()
    assert report["bills"]["paid_count"] == 0 and report["bills"]["open_count"] == 0
    assert report["bills"]["total_count"] == 0


def test_notifications_skip_prepaid(db, users, client_as, loan):
    inst = _prepay_last(db, users, client_as, loan)
    due = _open_bills_due(db, {inst.due_date})
    assert inst.id not in {i.id for i, _ in due}
