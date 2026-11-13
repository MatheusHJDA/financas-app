"""Teste de referência da U10 contra a aba Projeção da planilha v2 (lead; não editar).

Com as premissas padrão (as da planilha), a projeção tem de bater com a planilha:
quitação em abr/27 e R$ 1.428,87 de juros (tolerância de R$ 1 = 100 centavos).
Valores conferidos célula a célula em docs/referencia/Plano-financeiro-casal-v2.xlsx.
"""

import pytest

TOLERANCE = 100  # R$ 1,00

PLANILHA_ASSUMPTIONS = {
    "start_month": "2026-12-01",
    "months": 13,
    "salary_cents": 300000,
    "other_income_cents": 470000,
    "uber_monthly_cents": 260000,
    "uber_fuel_percent": 30,
    "fixed_bills_cents": 379927,
    "daily_expenses_cents": 110000,
    "contingency_cents": 60000,
    "health_plan_cents": 58000,
    "card_installments": [
        {"name": "Santander – Cama", "installment_cents": 38524, "count": 10, "first_month": 1},
        {"name": "Santander – Jim", "installment_cents": 28900, "count": 2, "first_month": 1},
        {"name": "Santander – Araguaia", "installment_cents": 23500, "count": 2, "first_month": 1},
        {"name": "Sicredi – Midea", "installment_cents": 27500, "count": 10, "first_month": 1},
    ],
    "loan_principal_cents": 2200000,
    "loan_monthly_rate": "0.0345",
    "loan_installments": 24,
    "loan_balance_cents": 2200000,
    "initial_amortization_cents": 800000,
    "cash_now_cents": 1090000,
    "upfront_payments_cents": 27500,
    "reserve_minimum_cents": 200000,
}

# Linha "Saldo devedor no fim do mês" (dez/26 a abr/27) e "Caixa no fim do mês" da planilha.
DEBT_END = [1102151, 856526, 550027, 232954, 0]
CASH_END = {1: 200000, 5: 295058, 13: 2717522}
EXTRA = [209867, 147367, 199767, 199767, 104709]


def _approx(value: int, expected: int) -> bool:
    return abs(value - expected) <= TOLERANCE


def test_premissas_padrao_sao_as_da_planilha(users, client_as):
    resp = client_as(users["ruth"]).get("/api/plan/assumptions")
    assert resp.status_code == 200
    assert resp.json() == PLANILHA_ASSUMPTIONS


def test_amortizar_agora_bate_com_a_planilha(users, client_as):
    resp = client_as(users["matheus"]).get(
        "/api/plan/projection", params={"scenario": "amortize_now"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["scenario"] == "amortize_now"
    assert body["payoff_month"] == "2027-04-01"
    assert _approx(body["total_interest_cents"], 142887)
    assert _approx(body["interest_without_amortization_cents"], 1070763)
    assert _approx(body["interest_saved_cents"], 1070763 - 142887)
    assert _approx(body["waiting_cost_per_month_cents"], 27600)

    months = body["months"]
    assert len(months) == 13
    assert months[0]["month"] == "2026-12-01" and months[-1]["month"] == "2027-12-01"
    for i, expected in enumerate(DEBT_END):
        assert _approx(months[i]["debt_balance_cents"], expected), i
        assert _approx(months[i]["amortization_cents"], EXTRA[i]), i
    for index, expected in CASH_END.items():
        assert _approx(months[index - 1]["reserve_cents"], expected), index
    # Mês 1: entradas 10.300,00; saídas 8.826,33 (inclui parcela de 1.362,82 e juros de 483,00).
    assert months[0]["income_cents"] == 1030000
    assert _approx(months[0]["expense_cents"], 882633)
    assert _approx(months[0]["loan_payment_cents"], 136282)
    assert _approx(months[0]["interest_cents"], 48300)
    # Depois da quitação: sem parcela, plano de saúde entra (saídas 7.519,51 em mai/27).
    assert months[5]["loan_payment_cents"] == 0 and months[5]["debt_balance_cents"] == 0
    assert _approx(months[5]["expense_cents"], 751951)
    # Parcelas dos cartões acabam depois de set/27 (saídas 6.859,27 em out/27).
    assert _approx(months[10]["expense_cents"], 685927)


def test_sem_amortizar_paga_so_as_parcelas(users, client_as):
    body = (
        client_as(users["ruth"])
        .get("/api/plan/projection", params={"scenario": "no_amortization"})
        .json()
    )
    assert body["scenario"] == "no_amortization"
    assert body["payoff_month"] is None
    assert all(m["amortization_cents"] == 0 for m in body["months"])
    assert _approx(body["months"][0]["debt_balance_cents"], 2139618)
    assert _approx(body["months"][12]["debt_balance_cents"], 1230103)
    assert _approx(body["total_interest_cents"], 801769)
    # Sem a amortização inicial, os R$ 8.000 continuam em caixa.
    assert _approx(body["months"][0]["reserve_cents"], 1209867)


@pytest.mark.parametrize("scenario", ["", "outro"])
def test_cenario_invalido_422(users, client_as, scenario):
    resp = client_as(users["ruth"]).get("/api/plan/projection", params={"scenario": scenario})
    assert resp.status_code == 422
