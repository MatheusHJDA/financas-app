import datetime as dt
from decimal import Decimal

from finance_api.db.models import BillInstance, Debt, RecurringBill
from finance_api.overview.router import _next_due_date, today_sao_paulo


def _bill(db, owner, name, due, status="open", amount=10000, debt_id=None):
    recurring = RecurringBill(
        debt_id=debt_id,
        owner=owner,
        name=name,
        amount_cents=amount,
        due_day=due.day,
        start_month=due.replace(day=1),
    )
    db.add(recurring)
    db.flush()
    instance = BillInstance(
        recurring_bill_id=recurring.id,
        month=due.replace(day=1),
        due_date=due,
        amount_cents=amount,
        status=status,
    )
    db.add(instance)
    db.flush()
    return instance


def _group(overview, owner):
    return next(g for g in overview["balances_by_owner"] if g["owner"] == owner)


def test_balances_grouped_by_owner_with_totals(client_as, users, make_account, make_tx):
    ruth = make_account("Nubank Ruth", owner="RUTH", initial=100000)
    matheus = make_account("Inter Matheus", owner="MATHEUS", initial=50000)
    joint = make_account("Conjunta", owner="AMBOS", initial=20000)
    make_tx(ruth, "income", 30000, owner="RUTH")
    make_tx(matheus, "expense", 10000)
    make_tx(joint, "expense", 5000, owner="AMBOS")
    make_account("Antiga", owner="RUTH", initial=999999, active=False)  # inativa não entra

    o = client_as(users["ruth"]).get("/api/overview").json()
    assert [g["owner"] for g in o["balances_by_owner"]] == ["RUTH", "MATHEUS", "AMBOS"]
    assert _group(o, "RUTH")["total_cents"] == 130000
    assert [a["name"] for a in _group(o, "RUTH")["accounts"]] == ["Nubank Ruth"]
    assert _group(o, "RUTH")["accounts"][0]["current_balance_cents"] == 130000
    assert _group(o, "MATHEUS")["total_cents"] == 40000
    assert _group(o, "AMBOS")["total_cents"] == 15000
    assert o["couple_total_cents"] == 185000


def test_internal_transfer_does_not_change_totals(client_as, users, make_account, make_tx):
    ruth = make_account("Ruth", owner="RUTH", initial=100000)
    matheus = make_account("Matheus", owner="MATHEUS", initial=50000)
    client = client_as(users["ruth"])
    before = client.get("/api/overview").json()
    make_tx(matheus, "transfer", 20000, to_account=ruth, owner="AMBOS")
    after = client.get("/api/overview").json()
    assert after["couple_total_cents"] == before["couple_total_cents"] == 150000
    assert _group(after, "RUTH")["total_cents"] == 120000
    assert _group(after, "MATHEUS")["total_cents"] == 30000


def test_open_card_invoices_and_paid_card(client_as, users, make_account, make_tx):
    checking = make_account("Corrente", initial=100000)
    card = make_account("Nubank cartão", type="credit_card", due_day=10, closing_day=3)
    paid = make_account("Outro cartão", type="credit_card")
    make_tx(card, "expense", 30000)
    make_tx(card, "expense", 12000)
    make_tx(paid, "expense", 5000)
    make_tx(checking, "transfer", 5000, to_account=paid)  # fatura quitada

    o = client_as(users["ruth"]).get("/api/overview").json()
    (invoice,) = o["open_card_invoices"]
    assert invoice["account_id"] == card.id
    assert invoice["account_name"] == "Nubank cartão"
    assert invoice["open_amount_cents"] == 42000
    assert invoice["due_date"] is not None
    # cartão e fatura não entram no dinheiro líquido; a conta corrente caiu com o pagamento
    assert o["couple_total_cents"] == 95000


def test_loan_balance_is_debt_and_amortization_reduces_it(client_as, users, make_account, make_tx):
    checking = make_account("Corrente", initial=500000)
    loan = make_account("Empréstimo", type="loan", owner="AMBOS", initial=-2200000)
    client = client_as(users["ruth"])
    assert client.get("/api/overview").json()["debts_balance_cents"] == 2200000
    make_tx(checking, "transfer", 136282, to_account=loan, owner="AMBOS")
    o = client.get("/api/overview").json()
    assert o["debts_balance_cents"] == 2200000 - 136282
    assert o["couple_total_cents"] == 500000 - 136282


def test_bills_upcoming_15_days_and_overdue(db, client_as, users):
    today = today_sao_paulo()
    day = dt.timedelta
    inside = _bill(db, "RUTH", "Luz CEMIG", today + day(days=15))
    today_bill = _bill(db, "AMBOS", "Internet", today)
    _bill(db, "RUTH", "Longe", today + day(days=16))
    late = _bill(db, "MATHEUS", "Água", today - day(days=3))
    _bill(db, "MATHEUS", "Já paga", today + day(days=2), status="paid")
    _bill(db, "MATHEUS", "Paga atrasada", today - day(days=2), status="paid")

    o = client_as(users["ruth"]).get("/api/overview").json()
    assert [b["id"] for b in o["upcoming_bills"]] == [today_bill.id, inside.id]
    assert o["upcoming_bills"][0]["name"] == "Internet"
    assert o["upcoming_bills"][0]["owner"] == "AMBOS"
    assert o["upcoming_bills"][1]["due_date"] == (today + day(days=15)).isoformat()
    assert [b["id"] for b in o["overdue_bills"]] == [late.id]
    assert o["overdue_bills"][0]["status"] == "open"


def test_empty_overview_has_all_fields(client_as, users):
    o = client_as(users["ruth"]).get("/api/overview").json()
    assert o["couple_total_cents"] == 0
    assert o["debts_balance_cents"] == 0
    assert o["open_card_invoices"] == [] and o["upcoming_bills"] == [] and o["overdue_bills"] == []
    assert len(o["balances_by_owner"]) == 3


def test_overview_requires_authentication(client_as):
    assert client_as(None).get("/api/overview").status_code == 401


def test_next_due_date():
    d = dt.date
    assert _next_due_date(d(2026, 11, 12), 20) == d(2026, 11, 20)
    assert _next_due_date(d(2026, 11, 12), 12) == d(2026, 11, 12)
    assert _next_due_date(d(2026, 11, 12), 5) == d(2026, 12, 5)
    assert _next_due_date(d(2026, 12, 12), 5) == d(2027, 1, 5)
    assert _next_due_date(d(2026, 2, 10), 31) == d(2026, 2, 28)  # mês curto
    assert _next_due_date(d(2026, 11, 12), None) is None


def test_debts_table_counts_in_debt_balance(db, client_as, users, make_account):
    db.add(
        Debt(
            owner="AMBOS",
            name="Empréstimo",
            principal_cents=2200000,
            monthly_rate=Decimal("0.0345"),
            installments=24,
            installment_cents=136282,
            start_date=dt.date(2026, 1, 1),
            current_balance_cents=2063718,
        )
    )
    db.flush()
    make_account("Outro", type="loan", owner="RUTH", initial=-10000)
    o = client_as(users["ruth"]).get("/api/overview").json()
    assert o["debts_balance_cents"] == 2063718 + 10000
    assert o["couple_total_cents"] == 0  # dívida não entra no dinheiro líquido


def test_bills_expose_debt_id_for_loan_managed_instances(db, client_as, users):
    today = today_sao_paulo()
    debt = Debt(
        owner="MATHEUS",
        name="Empréstimo",
        principal_cents=100000,
        monthly_rate=Decimal("0.02"),
        installments=10,
        installment_cents=10000,
        start_date=today,
        current_balance_cents=100000,
    )
    db.add(debt)
    db.flush()
    managed = _bill(db, "MATHEUS", "Empréstimo", today + dt.timedelta(days=2), debt_id=debt.id)
    plain = _bill(db, "MATHEUS", "Luz", today + dt.timedelta(days=3))
    o = client_as(users["matheus"]).get("/api/overview").json()
    by_id = {b["id"]: b for b in o["upcoming_bills"]}
    assert by_id[managed.id]["debt_id"] == debt.id
    assert by_id[plain.id]["debt_id"] is None
