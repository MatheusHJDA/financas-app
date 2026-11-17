from datetime import date

from sqlalchemy import func, select

from finance_api.bills.service import due_date_for, ensure_bill_instances
from finance_api.db.models import BillInstance


def _count(db) -> int:
    return db.scalar(select(func.count()).select_from(BillInstance))


def test_gera_instancia_do_mes_com_vencimento(db, make_bill):
    bill = make_bill(due_day=10, start_month=date(2026, 3, 1))
    assert ensure_bill_instances(db, date(2026, 3, 17)) == 1
    inst = db.scalar(select(BillInstance).where(BillInstance.recurring_bill_id == bill.id))
    assert inst.month == date(2026, 3, 1)
    assert inst.due_date == date(2026, 3, 10)
    assert inst.amount_cents == 18000
    assert inst.status == "open"


def test_idempotente(db, make_bill):
    make_bill()
    assert ensure_bill_instances(db, date(2026, 5, 1)) == 1
    assert ensure_bill_instances(db, date(2026, 5, 20)) == 0
    assert _count(db) == 1


def test_respeita_inicio_e_fim(db, make_bill):
    make_bill(start_month=date(2026, 3, 1), end_month=date(2026, 5, 1))
    assert ensure_bill_instances(db, date(2026, 2, 1)) == 0  # antes do início
    assert ensure_bill_instances(db, date(2026, 3, 1)) == 1  # primeiro mês
    assert ensure_bill_instances(db, date(2026, 5, 31)) == 1  # último mês (inclusive)
    assert ensure_bill_instances(db, date(2026, 6, 1)) == 0  # depois do fim
    assert _count(db) == 2


def test_dia_31_em_fevereiro_vira_ultimo_dia(db, make_bill):
    make_bill(due_day=31)
    ensure_bill_instances(db, date(2026, 2, 1))
    ensure_bill_instances(db, date(2028, 2, 1))  # bissexto
    ensure_bill_instances(db, date(2026, 4, 1))
    dues = sorted(db.scalars(select(BillInstance.due_date)).all())
    assert dues == [date(2026, 2, 28), date(2026, 4, 30), date(2028, 2, 29)]
    assert due_date_for(date(2026, 1, 1), 31) == date(2026, 1, 31)


def test_varias_contas_contam_so_as_novas(db, make_bill):
    make_bill(name="A")
    make_bill(name="B")
    assert ensure_bill_instances(db, date(2026, 6, 1)) == 2
    make_bill(name="C")
    assert ensure_bill_instances(db, date(2026, 6, 1)) == 1


def test_ensure_skips_debt_managed_bills(db, make_bill):
    from finance_api.db.models import Debt

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
    managed = make_bill(name="Empréstimo", debt_id=debt.id, start_month=date(2026, 12, 1))
    make_bill(name="Comum", start_month=date(2026, 12, 1))
    assert ensure_bill_instances(db, date(2026, 12, 1)) == 1
    assert (
        db.scalar(select(BillInstance).where(BillInstance.recurring_bill_id == managed.id)) is None
    )
