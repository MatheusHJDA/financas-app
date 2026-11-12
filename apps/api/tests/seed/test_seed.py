from datetime import date

from sqlalchemy import func, select

from finance_api.db.models import (
    Account,
    BillInstance,
    Category,
    Debt,
    Goal,
    RecurringBill,
    User,
)
from finance_api.seed import DEFAULT_SEED_PATH, load_seed


def _count(db, model) -> int:
    return db.scalar(select(func.count()).select_from(model))


def test_carga_inicial_secao_11(db):
    counts = load_seed(db, DEFAULT_SEED_PATH, today=date(2026, 11, 12))
    assert counts["categories"] == (18, 0)
    assert counts["recurring_bills"] == (14, 0)
    assert counts["debts"] == (3, 0)
    assert counts["goals"] == (4, 0)

    bills = {b.name: b for b in db.scalars(select(RecurringBill))}
    assert {b.owner for b in bills.values()} == {"AMBOS"}  # D20
    assert bills["Financiamento do carro (Banco Volkswagen)"].amount_cents == 166703
    assert bills["Internet Vero"].amount_cents == 8990
    assert bills["Hostinger"].amount_cents == 6499
    assert "confirmar se é mensal" in bills["Hostinger"].payment_method
    assert all(b.start_month == date(2026, 11, 1) and b.account_id is None for b in bills.values())
    assert _count(db, BillInstance) == 14  # mês corrente já gerado

    card_ok = set(
        db.scalars(select(Category.name).where(Category.is_recurring_card_allowed.is_(True)))
    )
    assert card_ok == {"Carro", "Saúde", "Assinaturas"}
    for name in ("Seguro Loovi", "Academia (Contorno do Corpo)", "Cartão de Todos", "Hostinger"):
        category = db.get(Category, bills[name].category_id)
        assert category.is_recurring_card_allowed

    loan = db.scalar(select(Debt).where(Debt.name == "Empréstimo"))
    assert (loan.principal_cents, loan.installments, loan.installment_cents) == (
        2200000,
        24,
        136282,
    )
    assert str(loan.monthly_rate) == "0.034500"
    assert loan.current_balance_cents == loan.principal_cents  # D14: sem amortização informada

    uber = db.scalar(select(Goal).where(Goal.name == "Uber diário"))
    assert uber.owner == "MATHEUS" and uber.period == "daily"
    assert uber.levels_json == [
        {"name": "Piso", "target_cents": 10000},
        {"name": "Meta", "target_cents": 13000},
        {"name": "Desafio", "target_cents": 16000},
    ]
    assert db.get(Category, uber.linked_category_id).name == "Uber/99"


def test_idempotente_e_nao_cria_usuarios_nem_contas(db):
    load_seed(db, DEFAULT_SEED_PATH, today=date(2026, 11, 12))
    before = {m: _count(db, m) for m in (Category, RecurringBill, BillInstance, Debt, Goal)}
    counts = load_seed(db, DEFAULT_SEED_PATH, today=date(2026, 11, 12))
    assert all(created == 0 for created, _ in counts.values())
    assert counts["recurring_bills"] == (0, 14)
    assert before == {m: _count(db, m) for m in (Category, RecurringBill, BillInstance, Debt, Goal)}
    assert _count(db, User) == 0 and _count(db, Account) == 0


def test_pula_o_que_ja_existe(db):
    db.add(Category(name="Moradia", kind="expense"))
    db.flush()
    counts = load_seed(db, DEFAULT_SEED_PATH, today=date(2026, 11, 12))
    assert counts["categories"] == (17, 1)
    assert _count(db, Category) == 18
