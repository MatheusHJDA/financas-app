import datetime as dt

from finance_api.core.permissions import Owner
from finance_api.db.models import BillInstance, RecurringBill
from finance_api.reports.service import build_month_report

NOV = dt.date(2026, 11, 1)
DEC = dt.date(2026, 12, 1)
JAN = dt.date(2027, 1, 1)


def _bill(db, name, due, status="open", amount=10000, owner="MATHEUS"):
    recurring = RecurringBill(
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


def test_mes_vazio_devolve_zeros(db, users):
    report = build_month_report(db, NOV, None, dt.date(2026, 11, 14))
    assert report.month == NOV
    assert (report.income_cents, report.expense_cents, report.balance_cents) == (0, 0, 0)
    assert report.expense_delta_cents == 0
    assert report.previous.income_cents == 0
    assert report.previous.expense_cents == 0
    assert report.by_category == []
    assert report.bills.model_dump() == {
        "total_count": 0,
        "paid_count": 0,
        "paid_cents": 0,
        "open_count": 0,
        "open_cents": 0,
    }
    current = report.daily_cumulative_expense.current
    assert [p.day for p in current] == list(range(1, 15))
    assert all(p.cents == 0 for p in current)
    assert len(report.daily_cumulative_expense.previous) == 31  # outubro


def test_totais_receita_despesa_e_transferencia_ignorada(db, users, make_account, make_tx):
    corrente = make_account("Corrente", initial=0)
    poupanca = make_account("Poupança", initial=0)
    make_tx(corrente, "income", 500000, date=dt.date(2026, 11, 5))
    make_tx(corrente, "expense", 120000, date=dt.date(2026, 11, 6))
    make_tx(corrente, "transfer", 30000, date=dt.date(2026, 11, 7), to_account=poupanca)

    report = build_month_report(db, NOV, None, dt.date(2026, 11, 14))
    assert report.income_cents == 500000
    assert report.expense_cents == 120000
    assert report.balance_cents == 380000
    assert report.daily_cumulative_expense.current[-1].cents == 120000  # transferência fora
    assert [c.total_cents for c in report.by_category] == [120000]


def test_por_categoria_ordenado_e_share_em_bp(db, users, make_account, make_tx, make_category):
    conta = make_account("Corrente")
    mercado = make_category("Mercado")
    make_tx(conta, "expense", 25000, date=dt.date(2026, 11, 3))  # sem categoria
    make_tx(conta, "expense", 75000, date=dt.date(2026, 11, 4), category=mercado)

    report = build_month_report(db, NOV, None, dt.date(2026, 11, 14))
    assert [(c.name, c.share_bp) for c in report.by_category] == [
        ("Mercado", 7500),
        ("Sem categoria", 2500),
    ]
    assert [c.category_id for c in report.by_category] == [mercado.id, None]
    assert [c.total_cents for c in report.by_category] == [75000, 25000]


def test_share_bp_arredonda_meio_para_cima(db, users, make_account, make_tx, make_category):
    conta = make_account("Corrente")
    for name in ("A", "B", "C"):  # 1/3 cada: 3333,33 bp → 3333
        make_tx(conta, "expense", 1000, date=dt.date(2026, 11, 3), category=make_category(name))
    report = build_month_report(db, NOV, None, dt.date(2026, 11, 14))
    assert [c.share_bp for c in report.by_category] == [3333, 3333, 3333]

    # 1 de 32 centavos = 312,5 bp → 313 (meio para cima); 31 de 32 = 9687,5 → 9688 (soma 10001)
    other = make_account("Outra")
    make_tx(other, "expense", 1, date=dt.date(2026, 10, 3), category=make_category("X"))
    make_tx(other, "expense", 31, date=dt.date(2026, 10, 3), category=make_category("Y"))
    report = build_month_report(db, dt.date(2026, 10, 1), None, dt.date(2026, 11, 14))
    assert {c.name: c.share_bp for c in report.by_category} == {"X": 313, "Y": 9688}


def test_filtro_owner(db, users, make_account, make_tx):
    conta = make_account("Corrente", owner="AMBOS")
    make_tx(conta, "expense", 10000, date=dt.date(2026, 11, 3), owner="RUTH")
    make_tx(conta, "expense", 20000, date=dt.date(2026, 11, 4), owner="MATHEUS")
    make_tx(conta, "income", 90000, date=dt.date(2026, 11, 5), owner="RUTH")
    make_tx(conta, "expense", 5000, date=dt.date(2026, 10, 5), owner="RUTH")
    make_tx(conta, "expense", 7000, date=dt.date(2026, 10, 5), owner="MATHEUS")
    today = dt.date(2026, 11, 14)

    ruth = build_month_report(db, NOV, Owner.RUTH, today)
    assert (ruth.income_cents, ruth.expense_cents) == (90000, 10000)
    assert ruth.previous.expense_cents == 5000
    assert ruth.daily_cumulative_expense.current[-1].cents == 10000

    todos = build_month_report(db, NOV, None, today)
    assert (todos.income_cents, todos.expense_cents) == (90000, 30000)
    assert todos.previous.expense_cents == 12000


def test_virada_de_mes_no_fuso_de_sp(db, users, make_account, make_tx):
    conta = make_account("Corrente")
    make_tx(conta, "expense", 4200, date=dt.date(2026, 12, 31))
    make_tx(conta, "expense", 800, date=dt.date(2027, 1, 1))
    today = dt.date(2027, 3, 1)

    dezembro = build_month_report(db, DEC, None, today)
    janeiro = build_month_report(db, JAN, None, today)
    assert dezembro.expense_cents == 4200
    assert janeiro.expense_cents == 800
    assert janeiro.previous.expense_cents == 4200
    assert dezembro.daily_cumulative_expense.current[30].model_dump() == {"day": 31, "cents": 4200}
    assert janeiro.daily_cumulative_expense.previous[30].cents == 4200


def test_acumulado_diario_mes_corrente_ate_hoje(db, users, make_account, make_tx):
    conta = make_account("Corrente")
    make_tx(conta, "expense", 1000, date=dt.date(2026, 11, 2))
    make_tx(conta, "expense", 500, date=dt.date(2026, 11, 2))
    make_tx(conta, "expense", 2000, date=dt.date(2026, 11, 30))
    make_tx(conta, "expense", 300, date=dt.date(2026, 12, 3))
    make_tx(conta, "expense", 700, date=dt.date(2026, 12, 7))
    make_tx(conta, "expense", 9999, date=dt.date(2026, 12, 20))  # depois de hoje

    report = build_month_report(db, DEC, None, dt.date(2026, 12, 10))
    current = report.daily_cumulative_expense.current
    previous = report.daily_cumulative_expense.previous
    assert [p.day for p in current] == list(range(1, 11))
    assert [p.cents for p in current] == [0, 0, 300, 300, 300, 300, 1000, 1000, 1000, 1000]
    assert len(previous) == 30
    assert previous[0].cents == 0
    assert previous[1].cents == 1500  # dia 2
    assert previous[28].cents == 1500  # dia 29 repete o acumulado
    assert previous[29].cents == 3500  # dia 30
    # o total do mês corrente inclui o que ainda vem depois de hoje
    assert report.expense_cents == 300 + 700 + 9999


def test_mes_futuro_tem_current_vazio_e_passado_completo(db, users, make_account, make_tx):
    conta = make_account("Corrente")
    make_tx(conta, "expense", 1000, date=dt.date(2026, 11, 2))
    today = dt.date(2026, 11, 14)

    futuro = build_month_report(db, DEC, None, today)
    assert futuro.daily_cumulative_expense.current == []
    assert len(futuro.daily_cumulative_expense.previous) == 30
    assert futuro.expense_cents == 0

    passado = build_month_report(db, NOV, None, dt.date(2026, 12, 10))
    assert len(passado.daily_cumulative_expense.current) == 30


def test_contas_fixas_do_mes(db, users):
    _bill(db, "Aluguel", dt.date(2026, 11, 5), status="paid", amount=10000)
    _bill(db, "Luz", dt.date(2026, 11, 10), amount=15000)
    _bill(db, "Internet", dt.date(2026, 11, 20), amount=9000)
    _bill(db, "Outro mês", dt.date(2026, 12, 5), amount=77000)

    report = build_month_report(db, NOV, None, dt.date(2026, 11, 14))
    assert report.bills.model_dump() == {
        "total_count": 3,
        "paid_count": 1,
        "paid_cents": 10000,
        "open_count": 2,
        "open_cents": 24000,
    }


def test_contas_pagas_somam_o_valor_do_lancamento_vinculado(db, users, make_account, make_tx):
    conta = make_account("Corrente")
    luz = _bill(db, "Luz", dt.date(2026, 11, 10), status="paid", amount=18000)
    luz.paid_transaction_id = make_tx(conta, "expense", 19540, date=dt.date(2026, 11, 10)).id
    _bill(db, "Aluguel", dt.date(2026, 11, 5), status="paid", amount=10000)  # sem lançamento
    _bill(db, "Internet", dt.date(2026, 11, 20), amount=9000)
    db.flush()

    report = build_month_report(db, NOV, None, dt.date(2026, 11, 14))
    assert report.bills.model_dump() == {
        "total_count": 3,
        "paid_count": 2,
        "paid_cents": 29540,  # 19540 (lançamento) + 10000 (valor da instância)
        "open_count": 1,
        "open_cents": 9000,
    }


def test_contas_fixas_respeitam_owner(db, users):
    _bill(db, "Aluguel", dt.date(2026, 11, 5), amount=10000, owner="RUTH")
    _bill(db, "Luz", dt.date(2026, 11, 10), amount=15000, owner="MATHEUS")

    report = build_month_report(db, NOV, Owner.RUTH, dt.date(2026, 11, 14))
    assert (report.bills.total_count, report.bills.open_cents) == (1, 10000)


def test_mes_anterior_e_delta(db, users, make_account, make_tx):
    conta = make_account("Corrente")
    make_tx(conta, "income", 300000, date=dt.date(2026, 11, 5))
    make_tx(conta, "expense", 50000, date=dt.date(2026, 11, 6))
    make_tx(conta, "income", 400000, date=dt.date(2026, 12, 5))
    make_tx(conta, "expense", 80000, date=dt.date(2026, 12, 6))

    report = build_month_report(db, DEC, None, dt.date(2026, 12, 10))
    assert report.previous.income_cents == 300000
    assert report.previous.expense_cents == 50000
    assert report.expense_delta_cents == 30000

    menos = build_month_report(db, NOV, None, dt.date(2026, 12, 10))
    assert menos.expense_delta_cents == 50000  # outubro vazio


def test_endpoint_devolve_relatorio(client_as, users, make_account, make_tx):
    conta = make_account("Corrente")
    make_tx(conta, "expense", 1234, date=dt.date(2026, 3, 10))
    body = client_as(users["ruth"]).get("/api/reports/month?month=2026-03").json()
    assert body["month"] == "2026-03-01"
    assert body["expense_cents"] == 1234
    assert body["by_category"][0]["name"] == "Sem categoria"
    assert len(body["daily_cumulative_expense"]["current"]) == 31


def test_endpoint_filtra_por_owner(client_as, users, make_account, make_tx):
    conta = make_account("Corrente", owner="AMBOS")
    make_tx(conta, "expense", 1000, date=dt.date(2026, 3, 10), owner="RUTH")
    make_tx(conta, "expense", 2000, date=dt.date(2026, 3, 10), owner="MATHEUS")
    client = client_as(users["matheus"])  # leitura sem restrição por dono, como /transactions
    assert client.get("/api/reports/month?month=2026-03&owner=RUTH").json()["expense_cents"] == 1000
    assert client.get("/api/reports/month?month=2026-03").json()["expense_cents"] == 3000


def test_mes_invalido_422(client_as, users):
    client = client_as(users["ruth"])
    for bad in ("2026-13", "2026-00", "2026", "abc", "2026-1"):
        assert client.get(f"/api/reports/month?month={bad}").status_code == 422, bad
    assert client.get("/api/reports/month").status_code == 422


def test_share_bp_com_total_zero_devolve_zero():
    from finance_api.reports.service import _share_bp

    assert _share_bp(100, 0) == 0


def test_mes_ano_zero_e_owner_invalido_422(client_as, users):
    client = client_as(users["ruth"])
    assert client.get("/api/reports/month?month=0000-01").status_code == 422
    assert client.get("/api/reports/month?month=2026-03&owner=FULANO").status_code == 422


def test_endpoint_mes_futuro_gera_as_contas_fixas_do_mes(client_as, users, db, monkeypatch):
    import finance_api.reports.router as reports_router

    monkeypatch.setattr(reports_router, "today_sao_paulo", lambda: dt.date(2026, 11, 14))
    db.add(
        RecurringBill(
            owner="MATHEUS", name="Internet", amount_cents=9990, due_day=10, start_month=NOV
        )
    )
    db.flush()
    body = client_as(users["ruth"]).get("/api/reports/month?month=2027-02").json()
    assert body["bills"]["total_count"] == 1
    assert body["bills"]["open_cents"] == 9990
