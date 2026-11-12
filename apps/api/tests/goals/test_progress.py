from datetime import date, timedelta

import pytest

from finance_api.bills.service import today_sp
from finance_api.db.models import Account, Category, Debt, Transaction


@pytest.fixture
def mk(db, users):
    """Fábricas de dados de apoio, criados direto pelos modelos."""

    class Mk:
        def category(self, name, kind="expense", parent_id=None):
            row = Category(name=name, kind=kind, parent_id=parent_id)
            db.add(row)
            db.flush()
            return row

        def account(self, initial=0, name="Conta"):
            row = Account(
                owner="AMBOS",
                created_by=users["matheus"].id,
                name=name,
                type="savings",
                initial_balance_cents=initial,
                initial_balance_date=date(2026, 1, 1),
            )
            db.add(row)
            db.flush()
            return row

        def tx(self, kind, cents, day, account, category=None, to_account=None):
            row = Transaction(
                kind=kind,
                amount_cents=cents,
                date=day,
                description="t",
                account_id=account.id,
                to_account_id=to_account.id if to_account else None,
                category_id=category.id if category else None,
                owner="AMBOS",
                created_by=users["matheus"].id,
                source="manual",
            )
            db.add(row)
            db.flush()
            return row

        def debt(self, name="Empréstimo", principal=2200000, balance=2200000):
            row = Debt(
                owner="AMBOS",
                name=name,
                principal_cents=principal,
                monthly_rate="0.0345",
                installments=24,
                installment_cents=136282,
                start_date=date(2026, 11, 1),
                current_balance_cents=balance,
            )
            db.add(row)
            db.flush()
            return row

    return Mk()


def _goal(client, **kw):
    data = {"owner": "AMBOS", "type": "accumulate", "name": "Meta", "target_cents": 100000}
    data.update(kw)
    resp = client.post("/api/goals", json=data)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _progress(client, goal_id):
    return client.get(f"/api/goals/{goal_id}").json()["progress"]


def test_acumular_por_aportes(users, client_as):
    client = client_as(users["matheus"])
    goal = _goal(client, name="Reserva", target_cents=200000)
    assert _progress(client, goal["id"]) == {
        "current_cents": 0,
        "target_cents": 200000,
        "percent": 0.0,
        "level": None,
    }
    for cents in (50000, 30000):
        resp = client.post(
            f"/api/goals/{goal['id']}/entries", json={"amount_cents": cents, "date": "2026-11-10"}
        )
        assert resp.status_code == 201 and resp.json()["goal_id"] == goal["id"]
    progress = _progress(client, goal["id"])
    assert progress["current_cents"] == 80000 and progress["percent"] == 40.0


def test_acumular_por_conta_vinculada_usa_saldo(users, client_as, mk):
    acc, other = mk.account(initial=100000), mk.account(name="Outra")
    cat = mk.category("Salário", "income")
    mk.tx("income", 50000, date(2026, 2, 1), acc, cat)
    mk.tx("expense", 20000, date(2026, 2, 2), acc)
    mk.tx("transfer", 10000, date(2026, 2, 3), other, to_account=acc)  # entra +10000
    mk.tx("transfer", 5000, date(2026, 2, 4), acc, to_account=other)  # sai -5000
    mk.tx("income", 99999, date(2025, 12, 31), acc, cat)  # antes do saldo inicial: ignorado
    client = client_as(users["matheus"])
    goal = _goal(client, linked_account_id=acc.id, target_cents=270000)
    progress = _progress(client, goal["id"])
    assert progress["current_cents"] == 135000
    assert progress["percent"] == 50.0


def test_quitar_divida_pelo_saldo_devedor(users, client_as, mk):
    debt = mk.debt(principal=2200000, balance=1650000)
    mk.debt(name="Outra dívida", principal=500000, balance=0)  # não casa com o nome
    client = client_as(users["matheus"])
    goal = _goal(client, type="debt_payoff", name="Quitar o empréstimo", target_cents=2200000)
    progress = _progress(client, goal["id"])
    assert progress["current_cents"] == 550000 and progress["percent"] == 25.0
    debt.current_balance_cents = 0
    client.patch(f"/api/debts/{debt.id}", json={"current_balance_cents": 0})
    assert _progress(client, goal["id"])["percent"] == 100.0


def test_receita_por_periodo_diario_com_niveis_do_uber(users, client_as, mk):
    uber = mk.category("Uber/99", "income")
    outra = mk.category("Salário", "income")
    acc = mk.account()
    hoje = today_sp()
    levels = [
        {"name": "Piso", "target_cents": 10000},
        {"name": "Meta", "target_cents": 13000},
        {"name": "Desafio", "target_cents": 16000},
    ]
    client = client_as(users["matheus"])
    goal = _goal(
        client,
        owner="MATHEUS",
        type="income_period",
        name="Uber diário",
        period="daily",
        target_cents=13000,
        levels=levels,
        linked_category_id=uber.id,
    )
    assert goal["levels"] == levels
    mk.tx("income", 99999, hoje - timedelta(days=1), acc, uber)  # ontem: fora do dia
    mk.tx("income", 77777, hoje, acc, outra)  # outra categoria
    mk.tx("expense", 1000, hoje, acc, uber)  # despesa não conta

    def check(expected_cents, level, percent):
        progress = _progress(client, goal["id"])
        assert progress["current_cents"] == expected_cents
        assert progress["level"] == level
        assert progress["percent"] == percent

    check(0, None, 0.0)
    mk.tx("income", 9000, hoje, acc, uber)
    check(9000, None, 69.23)
    mk.tx("income", 1000, hoje, acc, uber)
    check(10000, "Piso", 76.92)
    mk.tx("income", 3000, hoje, acc, uber)
    check(13000, "Meta", 100.0)
    mk.tx("income", 3500, hoje, acc, uber)
    check(16500, "Desafio", 126.92)


def test_receita_semanal_e_mensal_usam_o_periodo_corrente(users, client_as, mk):
    cat = mk.category("Uber/99", "income")
    acc = mk.account()
    hoje = today_sp()
    segunda = hoje - timedelta(days=hoje.weekday())
    inicio_mes = hoje.replace(day=1)
    mk.tx("income", 1000, segunda, acc, cat)
    mk.tx("income", 2000, segunda - timedelta(days=1), acc, cat)  # semana passada
    mk.tx("income", 4000, inicio_mes, acc, cat)
    client = client_as(users["matheus"])
    kw = {"type": "income_period", "linked_category_id": cat.id, "target_cents": 10000}
    weekly = _goal(client, name="Semana", period="weekly", **kw)
    monthly = _goal(client, name="Mês", period="monthly", **kw)
    week_cents = 1000 + (4000 if inicio_mes >= segunda else 0)
    assert _progress(client, weekly["id"])["current_cents"] == week_cents
    month_total = _progress(client, monthly["id"])["current_cents"]
    expected = (
        4000
        + (1000 if segunda >= inicio_mes else 0)
        + (2000 if segunda - timedelta(days=1) >= inicio_mes else 0)
    )
    assert month_total == expected


def test_teto_de_gasto_por_categoria_no_mes(users, client_as, mk):
    ifood = mk.category("iFood")
    sub = mk.category("iFood lanche", parent_id=ifood.id)
    outra = mk.category("Mercado")
    acc = mk.account()
    hoje = today_sp()
    mk.tx("expense", 30000, hoje.replace(day=1), acc, ifood)
    mk.tx("expense", 20000, hoje, acc, sub)  # subcategoria entra
    mk.tx("expense", 99999, hoje, acc, outra)
    mk.tx("expense", 88888, hoje.replace(day=1) - timedelta(days=1), acc, ifood)  # mês anterior
    mk.tx("income", 77777, hoje, acc, ifood)  # receita não conta
    client = client_as(users["ruth"])
    goal = _goal(
        client,
        owner="RUTH",
        type="category_cap",
        name="Teto iFood",
        target_cents=40000,
        period="monthly",
        linked_category_id=ifood.id,
    )
    progress = _progress(client, goal["id"])
    assert progress["current_cents"] == 50000
    assert progress["percent"] == 125.0  # estourou o teto


def test_lista_traz_progresso(users, client_as):
    client = client_as(users["matheus"])
    _goal(client, name="A")
    _goal(client, name="B")
    page = client.get("/api/goals").json()
    assert page["total"] == 2 and all("progress" in g for g in page["items"])
