from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from finance_api.db.models import Account, BillInstance, Category, Debt, DebtInstallment
from finance_api.debts.installments import pay_installments
from finance_api.seed import loan_nubank


@pytest.fixture
def setup(db, users):
    account = Account(
        owner="AMBOS",
        created_by=users["matheus"].id,
        name="Nubank (Matheus)",
        type="checking",
        initial_balance_cents=0,
        initial_balance_date=date(2026, 1, 1),
    )
    category = Category(name="Dívidas/Empréstimo", kind="expense")
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
    return debt, account


def test_dry_run_changes_nothing(db, setup):
    debt, _ = setup
    lines = loan_nubank.run(db, apply=False, debt_id=debt.id)
    db.refresh(debt)
    assert debt.name == "Empréstimo"
    assert debt.installments == 24
    assert db.scalar(select(func.count()).select_from(DebtInstallment)) == 0
    assert db.scalar(select(func.count()).select_from(BillInstance)) == 0
    assert any("DRY-RUN" in line for line in lines)


def test_apply_loads_schedule(db, setup):
    debt, _ = setup
    loan_nubank.run(db, apply=True, debt_id=debt.id)
    db.refresh(debt)
    items = list(db.scalars(select(DebtInstallment).order_by(DebtInstallment.number)))
    assert len(items) == 13
    assert sum(p.face_cents for p in items) == 1842842
    assert items[-1].face_cents == 141758
    assert debt.paid_before_app_cents == 818799
    assert debt.name == "Empréstimo"  # o nome fica: meta e seed.yaml casam por nome
    assert (debt.principal_cents, debt.installments, debt.installment_cents) == (
        2265965,
        13,
        141757,
    )
    assert debt.monthly_rate == Decimal("0.0345")
    assert debt.current_balance_cents == 1842842
    assert items[0].due_date == date(2026, 12, 18)
    assert items[-1].due_date == date(2027, 12, 20)


def test_apply_twice_is_refused_after_payment(db, setup, users):
    debt, account = setup
    loan_nubank.run(db, apply=True, debt_id=debt.id)
    loan_nubank.run(db, apply=True, debt_id=debt.id)  # sem pagamento: pode repetir
    last = db.scalar(select(DebtInstallment).order_by(DebtInstallment.number.desc()))
    pay_installments(db, users["matheus"], debt, [last.id], 100000, account.id, date(2026, 11, 17))
    with pytest.raises(ValueError, match="parcela paga"):
        loan_nubank.run(db, apply=True, debt_id=debt.id)


def test_missing_account_fails_clearly(db, setup):
    debt, account = setup
    account.name = "Outra"
    db.flush()
    with pytest.raises(LookupError, match="Nubank"):
        loan_nubank.run(db, apply=True, debt_id=debt.id)


def test_apply_keeps_goal_matching_debt(db, setup, users):
    from finance_api.db.models import Goal
    from finance_api.goals.service import compute_progress

    debt, _ = setup
    goal = Goal(owner="AMBOS", type="debt_payoff", name="Quitar o empréstimo", target_cents=0)
    db.add(goal)
    db.flush()
    loan_nubank.run(db, apply=True, debt_id=debt.id)
    db.refresh(debt)
    progress = compute_progress(db, goal, date(2026, 11, 17))
    assert progress["current_cents"] == debt.principal_cents - debt.current_balance_cents > 0


def test_guard_refuses_other_debt_name(db, setup):
    debt, _ = setup
    debt.name = "Financiamento"
    db.flush()
    with pytest.raises(ValueError, match="Financiamento"):
        loan_nubank.run(db, apply=True, debt_id=debt.id)


def test_guard_refuses_other_rate(db, setup):
    debt, _ = setup
    debt.monthly_rate = Decimal("0.0200")
    db.flush()
    with pytest.raises(ValueError, match="0.0200"):
        loan_nubank.run(db, apply=True, debt_id=debt.id)


def test_guard_allows_rerun_with_installments_and_dry_run_reports_them(db, setup, users):
    debt, account = setup
    loan_nubank.run(db, apply=True, debt_id=debt.id)
    debt.monthly_rate = Decimal("0.0350")  # já tem parcelas: guarda não bloqueia
    db.flush()
    first = db.scalar(select(DebtInstallment).order_by(DebtInstallment.number))
    lines = loan_nubank.run(db, apply=False, debt_id=debt.id)
    assert any("13 parcelas já cadastradas, 0 pagas" in line for line in lines)
    assert first is not None
