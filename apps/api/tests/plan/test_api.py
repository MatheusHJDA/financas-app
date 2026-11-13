"""Rotas /plan/* (U10): gravação, validação, auditoria e autenticação."""

import copy

import pytest
from sqlalchemy import select

from finance_api.db.models import AuditLog
from finance_api.plan.defaults import PLANILHA_ASSUMPTIONS


def body(**changes) -> dict:
    data = copy.deepcopy(PLANILHA_ASSUMPTIONS)
    data.update(changes)
    return data


def test_put_grava_e_get_devolve_o_que_foi_gravado(users, client_as):
    ruth = client_as(users["ruth"])
    new = body(salary_cents=350_000, loan_monthly_rate=" 0.03 ")
    resp = ruth.put("/api/plan/assumptions", json=new)
    assert resp.status_code == 200
    assert resp.json()["salary_cents"] == 350_000
    assert resp.json()["loan_monthly_rate"] == "0.03"  # normalizada

    again = client_as(users["matheus"]).get("/api/plan/assumptions")
    assert again.json()["salary_cents"] == 350_000
    assert again.json()["loan_monthly_rate"] == "0.03"


def test_put_grava_auditoria_com_antes_e_depois(users, client_as, db):
    client_as(users["ruth"]).put("/api/plan/assumptions", json=body(salary_cents=1))
    rows = db.scalars(select(AuditLog).where(AuditLog.entity == "plan")).all()
    assert len(rows) == 1
    row = rows[0]
    assert row.user_id == users["ruth"].id
    assert row.entity_id == "assumptions"
    assert row.action == "update"
    assert row.before_json["salary_cents"] == 300_000
    assert row.after_json["salary_cents"] == 1


def test_projecao_usa_as_premissas_gravadas(users, client_as):
    matheus = client_as(users["matheus"])
    matheus.put("/api/plan/assumptions", json=body(initial_amortization_cents=0))
    proj = matheus.get("/api/plan/projection", params={"scenario": "amortize_now"}).json()
    assert (
        proj["waiting_cost_per_month_cents"] == 0
    )  # sem amortização inicial não há custo de espera
    assert proj["months"][0]["loan_payment_cents"] == 136_282  # ainda paga a parcela Price
    # Saldo cheio (2.200.000 + juros 75.900 − parcela 136.282), menos só o excedente do mês.
    m1 = proj["months"][0]
    assert m1["debt_balance_cents"] == 2_139_618 - m1["amortization_cents"]


@pytest.mark.parametrize(
    "changes",
    [
        {"loan_monthly_rate": "abc"},
        {"loan_monthly_rate": "1.5"},
        {"loan_monthly_rate": "-0.01"},
        {"loan_monthly_rate": "NaN"},
        {"loan_monthly_rate": 0.0345},  # número, não texto
        {"start_month": "2026-12-15"},
        {
            "card_installments": [
                {"name": "X", "installment_cents": 1, "count": 0, "first_month": 1}
            ]
        },
        {
            "card_installments": [
                {"name": "X", "installment_cents": 1, "count": 121, "first_month": 1}
            ]
        },
        {
            "card_installments": [
                {"name": "X", "installment_cents": 1, "count": 1, "first_month": 0}
            ]
        },
        {"card_installments": [{"name": "", "installment_cents": 1, "count": 1, "first_month": 1}]},
        {"uber_fuel_percent": 101},
        {"months": 0},
        {"salary_cents": -1},
        {"initial_amortization_cents": 2_300_000},  # passa do saldo devedor
        {"extra_campo": 1},
    ],
)
def test_valor_invalido_da_422_e_nao_grava(users, client_as, changes):
    matheus = client_as(users["matheus"])
    resp = matheus.put("/api/plan/assumptions", json=body(**changes))
    assert resp.status_code == 422
    assert matheus.get("/api/plan/assumptions").json() == PLANILHA_ASSUMPTIONS


def test_taxa_zero_e_um_sao_aceitas(users, client_as):
    matheus = client_as(users["matheus"])
    assert matheus.put("/api/plan/assumptions", json=body(loan_monthly_rate="0")).status_code == 200
    assert matheus.put("/api/plan/assumptions", json=body(loan_monthly_rate="1")).status_code == 200


def test_rotas_exigem_login(client_as):
    anon = client_as(None)
    assert anon.get("/api/plan/assumptions").status_code == 401
    assert anon.put("/api/plan/assumptions", json=body()).status_code == 401
    assert anon.get("/api/plan/projection", params={"scenario": "amortize_now"}).status_code == 401
