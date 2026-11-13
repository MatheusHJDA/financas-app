"""Testes do motor puro da projeção (U10). Sem banco: casos de borda além do teste de referência."""

from datetime import date
from decimal import Decimal

from finance_api.plan.engine import (
    Assumptions,
    CardInstallment,
    add_months,
    monthly_payment_cents,
    project,
    round_cents,
)


def make(**overrides) -> Assumptions:
    base = dict(
        start_month=date(2026, 12, 1),
        months=3,
        salary_cents=0,
        other_income_cents=0,
        uber_monthly_cents=0,
        uber_fuel_percent=0,
        fixed_bills_cents=0,
        daily_expenses_cents=0,
        contingency_cents=0,
        health_plan_cents=0,
        card_installments=(),
        loan_principal_cents=0,
        loan_monthly_rate=Decimal("0"),
        loan_installments=1,
        loan_balance_cents=0,
        initial_amortization_cents=0,
        cash_now_cents=0,
        upfront_payments_cents=0,
        reserve_minimum_cents=0,
    )
    base.update(overrides)
    return Assumptions(**base)


def test_parcela_price_arredonda_ao_centavo():
    assert monthly_payment_cents(2_200_000, Decimal("0.0345"), 24) == 136_282


def test_parcela_com_taxa_zero_divide_o_principal():
    assert monthly_payment_cents(1_000, Decimal("0"), 3) == 333
    assert monthly_payment_cents(1_000, Decimal("0"), 8) == 125


def test_arredondamento_meio_para_cima():
    assert round_cents(Decimal("0.5")) == 1
    assert round_cents(Decimal("2.5")) == 3
    assert round_cents(Decimal("2.49")) == 2


def test_add_months_vira_o_ano():
    assert add_months(date(2026, 12, 1), 1) == date(2027, 1, 1)
    assert add_months(date(2026, 12, 1), 13) == date(2028, 1, 1)


def test_cartao_so_conta_nos_meses_da_sua_janela():
    cards = (
        CardInstallment("A", 1_000, count=2, first_month=1),  # meses 1 e 2
        CardInstallment("B", 500, count=1, first_month=3),  # só mês 3
    )
    proj = project(make(card_installments=cards, months=4), "no_amortization")
    assert [m.expense_cents for m in proj.months] == [1_000, 1_000, 500, 0]


def test_cartao_que_termina_some_da_saida():
    cards = (CardInstallment("A", 700, count=1, first_month=1),)
    proj = project(make(card_installments=cards, months=2), "no_amortization")
    assert proj.months[0].expense_cents == 700
    assert proj.months[1].expense_cents == 0


def test_quitacao_no_meio_do_periodo_zera_parcela_e_entra_plano_de_saude():
    # Saldo 200,00 com r = 0: parcela da Price (100,00 × 2) paga tudo no mês 1 ou 2.
    a = make(
        months=4,
        loan_principal_cents=20_000,
        loan_monthly_rate=Decimal("0"),
        loan_installments=2,
        loan_balance_cents=20_000,
        health_plan_cents=5_800,
        cash_now_cents=100_000,
    )
    proj = project(a, "no_amortization")
    assert proj.payoff_month == date(2027, 1, 1)  # mês 2: quita
    m1, m2, m3, m4 = proj.months
    assert m1.loan_payment_cents == 10_000 and m1.debt_balance_cents == 10_000
    assert m2.loan_payment_cents == 10_000 and m2.debt_balance_cents == 0
    assert m3.loan_payment_cents == 0 and m4.loan_payment_cents == 0
    # Plano de saúde só entra depois do saldo zerar (saldo_início == 0).
    assert m2.expense_cents == 10_000  # mês em que quita ainda não é "início zero"
    assert m3.expense_cents == 5_800


def test_caixa_abaixo_da_reserva_nao_amortiza():
    a = make(
        months=2,
        loan_principal_cents=100_000,
        loan_monthly_rate=Decimal("0"),
        loan_installments=10,
        loan_balance_cents=100_000,
        initial_amortization_cents=0,
        cash_now_cents=50_000,
        reserve_minimum_cents=200_000,
        salary_cents=10_000,
    )
    proj = project(a, "amortize_now")
    assert all(m.amortization_cents == 0 for m in proj.months)
    # Caixa: 50.000 + 10.000 de salário − 10.000 de parcela = 50.000, abaixo da reserva de 200.000.
    assert proj.months[0].reserve_cents == 50_000
    assert proj.payoff_month is None
    assert proj.months[-1].debt_balance_cents == 80_000


def test_amortizacao_limitada_pelo_saldo_restante():
    # Caixa sobra muito, mas o saldo só tem 1.000,00 de principal: amortiza só isso.
    a = make(
        months=1,
        loan_principal_cents=100_000,
        loan_monthly_rate=Decimal("0"),
        loan_installments=2,
        loan_balance_cents=100_000,
        cash_now_cents=10_000_000,
        reserve_minimum_cents=0,
    )
    proj = project(a, "amortize_now")
    m = proj.months[0]
    assert m.loan_payment_cents == 50_000
    assert m.amortization_cents == 50_000
    assert m.debt_balance_cents == 0
    assert proj.payoff_month == date(2026, 12, 1)


def test_sem_amortizar_ignora_caixa_sobrando():
    a = make(
        months=2,
        loan_principal_cents=100_000,
        loan_monthly_rate=Decimal("0"),
        loan_installments=10,
        loan_balance_cents=100_000,
        cash_now_cents=10_000_000,
    )
    proj = project(a, "no_amortization")
    assert all(m.amortization_cents == 0 for m in proj.months)
    assert proj.months[1].debt_balance_cents == 80_000


def test_premissas_zeradas_nao_quitam_nem_cobram():
    proj = project(make(months=2), "amortize_now")
    assert proj.payoff_month == date(2026, 12, 1)
    assert proj.total_interest_cents == 0
    assert proj.interest_without_amortization_cents == 0
    assert proj.interest_saved_cents == 0
    assert proj.waiting_cost_per_month_cents == 0
    assert all(m.expense_cents == 0 and m.reserve_cents == 0 for m in proj.months)


def test_months_igual_a_um():
    a = make(
        months=1,
        loan_principal_cents=2_200_000,
        loan_monthly_rate=Decimal("0.0345"),
        loan_installments=24,
        loan_balance_cents=2_200_000,
        salary_cents=300_000,
        cash_now_cents=0,
    )
    proj = project(a, "no_amortization")
    assert len(proj.months) == 1
    m = proj.months[0]
    assert m.month == date(2026, 12, 1)
    assert m.interest_cents == 75_900
    assert m.loan_payment_cents == 136_282
    assert m.debt_balance_cents == 2_200_000 + 75_900 - 136_282
    assert proj.payoff_month is None


def test_custo_de_esperar_um_mes_e_valor_vezes_taxa():
    a = make(
        months=1,
        loan_principal_cents=2_200_000,
        loan_monthly_rate=Decimal("0.0345"),
        loan_installments=24,
        loan_balance_cents=2_200_000,
        initial_amortization_cents=800_000,
    )
    assert project(a, "amortize_now").waiting_cost_per_month_cents == 27_600


def test_juros_sem_amortizar_usam_pmt_vezes_parcelas_menos_principal():
    a = make(
        months=24,
        loan_principal_cents=2_200_000,
        loan_monthly_rate=Decimal("0.0345"),
        loan_installments=24,
        loan_balance_cents=2_200_000,
    )
    proj = project(a, "no_amortization")
    assert proj.interest_without_amortization_cents == 136_282 * 24 - 2_200_000
    assert proj.interest_saved_cents == 0  # sem amortizar não há economia


def test_sem_amortizar_nao_tem_economia():
    a = make(
        months=13,
        salary_cents=1_000_000,
        loan_principal_cents=2_200_000,
        loan_monthly_rate=Decimal("0.0345"),
        loan_installments=24,
        loan_balance_cents=2_200_000,
    )
    assert project(a, "no_amortization").interest_saved_cents == 0
    assert project(a, "amortize_now").interest_saved_cents > 0
