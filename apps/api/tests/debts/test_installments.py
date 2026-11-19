from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from finance_api.db.models import (
    Account,
    BillInstance,
    Category,
    Debt,
    DebtInstallment,
    RecurringBill,
    Transaction,
)
from finance_api.debts.installments import (
    InstallmentSpec,
    loan_summary,
    pay_installments,
    set_schedule,
    split_amount,
)
from finance_api.transactions.service import release_bill_instance, update_transaction

FACE = 141757
DUES = [
    date(2026, 12, 18),
    date(2027, 1, 18),
    date(2027, 2, 18),
    date(2027, 3, 18),
    date(2027, 4, 19),
    date(2027, 5, 18),
    date(2027, 6, 18),
    date(2027, 7, 19),
    date(2027, 8, 18),
    date(2027, 9, 20),
    date(2027, 10, 18),
    date(2027, 11, 18),
    date(2027, 12, 20),
]
HOJE = date(2026, 11, 17)


@pytest.fixture
def loan(db, users):
    """Dívida AMBOS com as 13 parcelas do spec, conta Nubank e categoria Dívidas/Empréstimo."""
    account = Account(
        owner="AMBOS",
        created_by=users["matheus"].id,
        name="Nubank (Matheus)",
        type="checking",
        initial_balance_cents=0,
        initial_balance_date=date(2026, 1, 1),
    )
    parent = Category(name="Dívidas", kind="expense")
    db.add_all([account, parent])
    db.flush()
    category = Category(name="Empréstimo", kind="expense", parent_id=parent.id)
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
    db.add_all([category, debt])
    db.flush()
    specs = [InstallmentSpec(n, due, FACE) for n, due in enumerate(DUES, start=1)]
    set_schedule(db, users["matheus"], debt, specs, 818799, account.id, category.id)
    db.flush()
    return {"debt": debt, "account": account, "category": category}


def _parcelas(db, debt):
    return list(
        db.scalars(
            select(DebtInstallment)
            .where(DebtInstallment.debt_id == debt.id)
            .order_by(DebtInstallment.number)
        )
    )


def _tx_count(db):
    return db.scalar(select(func.count()).select_from(Transaction))


def _prepay_last_two(db, users, loan):
    debt = loan["debt"]
    ps = _parcelas(db, debt)
    return pay_installments(
        db, users["matheus"], debt, [ps[11].id, ps[12].id], 185367, loan["account"].id, HOJE
    )


def test_set_schedule_creates_bill_and_instances(db, loan):
    debt = loan["debt"]
    bills = list(db.scalars(select(RecurringBill).where(RecurringBill.debt_id == debt.id)))
    assert len(bills) == 1
    bill = bills[0]
    assert bill.amount_cents == FACE and bill.due_day == 18
    assert bill.start_month == date(2026, 12, 1) and bill.end_month == date(2027, 12, 1)
    insts = list(
        db.scalars(
            select(BillInstance)
            .where(BillInstance.recurring_bill_id == bill.id)
            .order_by(BillInstance.due_date)
        )
    )
    assert [i.due_date for i in insts] == DUES
    assert all(i.status == "open" and i.amount_cents == FACE for i in insts)
    assert [i.month for i in insts] == [d.replace(day=1) for d in DUES]
    assert debt.current_balance_cents == 13 * FACE
    assert debt.paid_before_app_cents == 818799


def test_summary_totals(db, loan):
    summary = loan_summary(db, loan["debt"], HOJE)
    assert summary.remaining_cents == 1842841
    assert summary.paid_cents == 818799
    assert abs(summary.payoff_today_cents - 1463495) <= 1463495 * 0.003
    assert [i.number for i in summary.items] == list(range(1, 14))
    first = summary.items[0]
    assert first.savings_cents == first.face_cents - first.today_cents


def test_prepay_last_two_creates_one_expense(db, users, loan):
    debt = loan["debt"]
    before = _tx_count(db)
    tx = _prepay_last_two(db, users, loan)
    assert _tx_count(db) == before + 1
    assert tx.kind == "expense" and tx.amount_cents == 185367 and tx.date == HOJE
    assert tx.description == "Empréstimo — adiantamento parcelas 12ª, 13ª"
    assert tx.category_id == loan["category"].id
    ps = _parcelas(db, debt)
    for p in ps[11:]:
        assert p.status == "prepaid" and p.transaction_id == tx.id and p.paid_on == HOJE
        inst = db.get(BillInstance, p.bill_instance_id)
        assert inst.status == "prepaid" and inst.paid_transaction_id == tx.id
    assert ps[11].paid_cents + ps[12].paid_cents == 185367
    assert all(p.status == "open" for p in ps[:11])
    assert debt.current_balance_cents == 11 * FACE
    assert loan_summary(db, debt, HOJE).paid_cents == 818799 + 185367


def test_pay_in_due_month_is_paid(db, users, loan):
    debt = loan["debt"]
    p = _parcelas(db, debt)[0]
    tx = pay_installments(
        db, users["matheus"], debt, [p.id], FACE, loan["account"].id, date(2026, 12, 10)
    )
    assert tx.description == "Empréstimo — parcela 1ª"
    assert p.status == "paid" and p.paid_cents == FACE
    assert db.get(BillInstance, p.bill_instance_id).status == "paid"


def test_pay_overdue_is_paid(db, users, loan):
    debt = loan["debt"]
    p = _parcelas(db, debt)[0]
    pay_installments(db, users["matheus"], debt, [p.id], FACE, loan["account"].id, date(2027, 1, 5))
    assert p.status == "paid"
    assert db.get(BillInstance, p.bill_instance_id).status == "paid"


def test_pay_twice_conflict(db, users, loan):
    debt = loan["debt"]
    _prepay_last_two(db, users, loan)
    count = _tx_count(db)
    last = _parcelas(db, debt)[12]
    with pytest.raises(HTTPException) as exc:
        pay_installments(db, users["matheus"], debt, [last.id], 90000, loan["account"].id, HOJE)
    assert exc.value.status_code == 409
    assert _tx_count(db) == count


def test_pay_invalid_requests_422(db, users, loan, make_other_debt):
    debt = loan["debt"]
    p = _parcelas(db, debt)[0]
    acc = loan["account"].id
    for ids, amount in [([], 100), ([p.id], 0), ([make_other_debt], 100)]:
        with pytest.raises(HTTPException) as exc:
            pay_installments(db, users["matheus"], debt, ids, amount, acc, HOJE)
        assert exc.value.status_code == 422


@pytest.fixture
def make_other_debt(db, users, loan):
    """Id de uma parcela de outra dívida."""
    other = Debt(
        owner="AMBOS",
        name="Outro",
        principal_cents=100000,
        monthly_rate=Decimal("0.02"),
        installments=1,
        installment_cents=100000,
        start_date=date(2026, 1, 1),
        current_balance_cents=100000,
    )
    db.add(other)
    db.flush()
    set_schedule(
        db,
        users["matheus"],
        other,
        [InstallmentSpec(1, date(2027, 1, 5), 100000)],
        0,
        loan["account"].id,
        None,
    )
    return _parcelas(db, other)[0].id


def test_delete_prepayment_reopens_all(db, users, loan, client_as):
    debt = loan["debt"]
    tx = _prepay_last_two(db, users, loan)
    resp = client_as(users["matheus"]).delete(f"/api/transactions/{tx.id}")
    assert resp.status_code == 204
    db.expire_all()
    ps = _parcelas(db, debt)
    for p in ps[11:]:
        assert p.status == "open" and p.paid_cents is None and p.paid_on is None
        assert p.transaction_id is None
        inst = db.get(BillInstance, p.bill_instance_id)
        assert inst.status == "open" and inst.paid_transaction_id is None
    assert db.get(Debt, debt.id).current_balance_cents == 13 * FACE


def test_release_bill_instance_reopens(db, users, loan):
    debt = loan["debt"]
    tx = _prepay_last_two(db, users, loan)
    release_bill_instance(db, users["matheus"], tx)
    assert all(p.status == "open" for p in _parcelas(db, debt))
    assert debt.current_balance_cents == 13 * FACE


def test_edit_amount_resplits(db, users, loan):
    debt = loan["debt"]
    tx = _prepay_last_two(db, users, loan)
    update_transaction(db, users["matheus"], tx, {"amount_cents": 180000})
    ps = _parcelas(db, debt)
    assert ps[11].paid_cents + ps[12].paid_cents == 180000


def test_edit_date_recomputes_status(db, users, loan):
    debt = loan["debt"]
    p = _parcelas(db, debt)[0]
    tx = pay_installments(db, users["matheus"], debt, [p.id], FACE, loan["account"].id, HOJE)
    assert p.status == "prepaid"
    update_transaction(db, users["matheus"], tx, {"date": date(2026, 12, 18)})
    assert p.status == "paid" and p.paid_on == date(2026, 12, 18)
    assert db.get(BillInstance, p.bill_instance_id).status == "paid"


def test_change_to_income_releases(db, users, loan):
    debt = loan["debt"]
    tx = _prepay_last_two(db, users, loan)
    update_transaction(db, users["matheus"], tx, {"kind": "income"})
    ps = _parcelas(db, debt)
    assert all(p.status == "open" and p.transaction_id is None for p in ps)
    assert debt.current_balance_cents == 13 * FACE


def test_split_amount_exact():
    assert split_amount(100, [1, 1, 1]) == [33, 33, 34]
    assert sum(split_amount(185367, [94255, 91112])) == 185367


def test_ruth_can_pay_ambos_debt(db, users, loan):
    debt = loan["debt"]
    p = _parcelas(db, debt)[0]
    tx = pay_installments(db, users["ruth"], debt, [p.id], FACE, loan["account"].id, HOJE)
    assert tx.created_by == users["ruth"].id
    assert p.status == "prepaid"


def test_set_schedule_refuses_after_payment(db, users, loan):
    debt = loan["debt"]
    _prepay_last_two(db, users, loan)
    specs = [InstallmentSpec(n, due, FACE) for n, due in enumerate(DUES, start=1)]
    with pytest.raises(ValueError):
        set_schedule(db, users["matheus"], debt, specs, 818799, loan["account"].id, None)


def test_set_schedule_recreates_and_validates(db, users, loan):
    debt = loan["debt"]
    specs = [InstallmentSpec(1, date(2027, 1, 5), 5000), InstallmentSpec(2, date(2027, 2, 5), 5000)]
    set_schedule(db, users["matheus"], debt, specs, 0, loan["account"].id, None)
    assert len(_parcelas(db, debt)) == 2
    assert db.scalar(select(func.count()).select_from(RecurringBill)) == 1
    assert debt.current_balance_cents == 10000
    for bad in (
        [InstallmentSpec(1, date(2027, 1, 5), 1), InstallmentSpec(2, date(2027, 1, 20), 1)],
        [InstallmentSpec(1, date(2027, 1, 5), 1), InstallmentSpec(1, date(2027, 2, 5), 1)],
    ):
        with pytest.raises(ValueError):
            set_schedule(db, users["matheus"], debt, bad, 0, loan["account"].id, None)


def test_report_paid_bills_use_each_installment_share(db, users, loan):
    """Uma despesa cobrindo parcela do mês + adiantada não infla 'Contas pagas' do mês."""
    from finance_api.reports.service import build_month_report

    debt = loan["debt"]
    ps = _parcelas(db, debt)
    # 1ª (dez/2026, paga no mês) + 13ª (dez/2027, adiantada) em uma única despesa
    pay_installments(
        db,
        users["matheus"],
        debt,
        [ps[0].id, ps[12].id],
        200000,
        loan["account"].id,
        date(2026, 12, 10),
    )
    report = build_month_report(db, date(2026, 12, 1), None, date(2026, 12, 10))
    assert (report.bills.paid_count, report.bills.paid_cents) == (1, ps[0].paid_cents)
    assert ps[0].paid_cents < 200000


def test_report_overdue_and_current_paid_together_split_by_month(db, users, loan):
    from finance_api.reports.service import build_month_report

    debt = loan["debt"]
    ps = _parcelas(db, debt)
    pay_installments(
        db,
        users["matheus"],
        debt,
        [ps[0].id, ps[1].id],
        283514,
        loan["account"].id,
        date(2027, 1, 25),
    )
    dez = build_month_report(db, date(2026, 12, 1), None, date(2027, 1, 25))
    jan = build_month_report(db, date(2027, 1, 1), None, date(2027, 1, 25))
    assert dez.bills.paid_cents == ps[0].paid_cents
    assert jan.bills.paid_cents == ps[1].paid_cents
    assert dez.bills.paid_cents + jan.bills.paid_cents == 283514


def test_resplit_audits_installment_and_instance(db, users, loan):
    from finance_api.db.models import AuditLog

    debt = loan["debt"]
    p = _parcelas(db, debt)[0]
    tx = pay_installments(db, users["matheus"], debt, [p.id], FACE, loan["account"].id, HOJE)
    update_transaction(db, users["matheus"], tx, {"date": date(2026, 12, 18)})  # prepaid -> paid
    rows = list(
        db.scalars(
            select(AuditLog).where(
                AuditLog.entity == "bill_instances",
                AuditLog.entity_id == str(p.bill_instance_id),
            )
        )
    )
    flip = [r for r in rows if r.before_json.get("status") == "prepaid"]
    assert len(flip) == 1 and flip[0].after_json["status"] == "paid"
    inst_rows = list(
        db.scalars(
            select(AuditLog).where(
                AuditLog.entity == "debt_installments", AuditLog.entity_id == str(p.id)
            )
        )
    )
    assert any(
        r.before_json["status"] == "prepaid"
        and r.after_json["status"] == "paid"
        and r.after_json["paid_on"] == "2026-12-18"
        for r in inst_rows
    )


def test_goal_quitar_emprestimo_uses_total_paid(db, users, loan):
    """A meta de quitar mostra o mesmo "total pago" da tela do empréstimo, não principal − saldo
    (principal é sem juros e o saldo é a soma das parcelas com juros)."""
    from finance_api.db.models import Goal
    from finance_api.goals.service import compute_progress

    goal = Goal(owner="AMBOS", type="debt_payoff", name="Quitar o empréstimo", target_cents=2200000)
    db.add(goal)
    db.flush()
    assert compute_progress(db, goal, HOJE)["current_cents"] == 818799
    _prepay_last_two(db, users, loan)
    assert compute_progress(db, goal, HOJE)["current_cents"] == 818799 + 185367
