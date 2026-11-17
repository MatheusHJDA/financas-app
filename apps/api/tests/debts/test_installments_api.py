"""Rotas do empréstimo com parcelas: resumo, pagamento/adiantamento e trava de campos."""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from finance_api.db.models import Account, Category, Debt, DebtInstallment, Transaction
from finance_api.debts.installments import InstallmentSpec, set_schedule

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
    return {"debt": debt, "account": account}


def _ids(db, debt):
    return list(
        db.scalars(
            select(DebtInstallment.id)
            .where(DebtInstallment.debt_id == debt.id)
            .order_by(DebtInstallment.number)
        )
    )


def test_get_installments_summary(users, client_as, loan):
    debt = loan["debt"]
    resp = client_as(users["matheus"]).get(f"/api/debts/{debt.id}/installments")
    assert resp.status_code == 200
    body = resp.json()
    assert body["remaining_cents"] == 3 * FACE
    assert body["paid_cents"] == 818799
    assert 0 < body["payoff_today_cents"] <= 3 * FACE
    assert [i["number"] for i in body["items"]] == [1, 2, 3]
    first = body["items"][0]
    assert first["status"] == "open" and first["face_cents"] == FACE
    assert first["savings_cents"] == FACE - first["today_cents"]
    assert first["paid_cents"] is None and first["paid_on"] is None
    assert isinstance(first["bill_instance_id"], int)


def test_get_installments_without_schedule(db, users, client_as):
    debt = Debt(
        owner="AMBOS",
        name="Antiga",
        principal_cents=100000,
        monthly_rate=Decimal("0.01"),
        installments=10,
        installment_cents=10000,
        start_date=date(2026, 1, 1),
        current_balance_cents=50000,
    )
    db.add(debt)
    db.flush()
    body = client_as(users["matheus"]).get(f"/api/debts/{debt.id}/installments").json()
    assert body == {"remaining_cents": 50000, "paid_cents": 0, "payoff_today_cents": 0, "items": []}


def test_get_installments_404(users, client_as):
    assert client_as(users["matheus"]).get("/api/debts/999999/installments").status_code == 404


def test_pay_installments_route(db, users, client_as, loan):
    debt, account = loan["debt"], loan["account"]
    ids = _ids(db, debt)
    before = db.scalar(select(func.count()).select_from(Transaction))
    resp = client_as(users["matheus"]).post(
        f"/api/debts/{debt.id}/installments/pay",
        json={
            "installment_ids": ids[1:],
            "amount_cents": 200000,
            "account_id": account.id,
            "date": "2026-11-17",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert db.scalar(select(func.count()).select_from(Transaction)) == before + 1
    assert [i["status"] for i in body["items"]] == ["open", "prepaid", "prepaid"]
    paid = body["items"][1:]
    assert sum(i["paid_cents"] for i in paid) == 200000
    assert all(i["today_cents"] is None and i["savings_cents"] is None for i in paid)
    assert all(i["paid_on"] == "2026-11-17" for i in paid)
    assert body["remaining_cents"] == FACE
    assert body["paid_cents"] == 818799 + 200000


def test_pay_installments_route_conflict_and_validation(db, users, client_as, loan):
    debt, account = loan["debt"], loan["account"]
    ids = _ids(db, debt)
    client = client_as(users["matheus"])
    url = f"/api/debts/{debt.id}/installments/pay"
    ok = {"installment_ids": [ids[0]], "amount_cents": FACE, "account_id": account.id}
    assert client.post(url, json={**ok, "date": "2026-12-18"}).status_code == 200
    assert client.post(url, json={**ok, "date": "2026-12-18"}).status_code == 409
    empty = {**ok, "installment_ids": [], "date": "2026-12-18"}
    assert client.post(url, json=empty).status_code == 422
    bad_amount = {**ok, "installment_ids": [ids[1]], "amount_cents": 0, "date": "2026-12-18"}
    assert client.post(url, json=bad_amount).status_code == 422
    assert client.post(url, json={**ok, "installment_ids": [ids[1]]}).status_code == 422  # sem data


def test_debt_out_has_new_fields(db, users, client_as, loan):
    debt = loan["debt"]
    client = client_as(users["matheus"])
    body = client.get(f"/api/debts/{debt.id}").json()
    assert body["paid_before_app_cents"] == 818799
    assert body["has_installments"] is True
    assert body["current_balance_cents"] == 3 * FACE
    listed = {d["id"]: d for d in client.get("/api/debts").json()["items"]}
    assert listed[debt.id]["has_installments"] is True
    other = client.post(
        "/api/debts",
        json={
            "owner": "AMBOS",
            "name": "Outra",
            "principal_cents": 1000,
            "monthly_rate": "0.01",
            "installments": 1,
            "installment_cents": 1000,
            "start_date": "2026-11-01",
            "current_balance_cents": 1000,
        },
    ).json()
    assert other["has_installments"] is False and other["paid_before_app_cents"] == 0


def test_patch_derived_fields_conflict(users, client_as, loan):
    debt = loan["debt"]
    client = client_as(users["matheus"])
    url = f"/api/debts/{debt.id}"
    assert client.patch(url, json={"current_balance_cents": 1}).status_code == 409
    assert client.patch(url, json={"installment_cents": 1}).status_code == 409
    resp = client.patch(url, json={"name": "Empréstimo Nubank"})
    assert resp.status_code == 200 and resp.json()["name"] == "Empréstimo Nubank"
