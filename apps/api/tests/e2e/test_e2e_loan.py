"""Empréstimo com parcelas (spec 2026-11-17): adiantar a última parcela e o layout da tela.

O teste cria o próprio empréstimo no banco descartável (não depende da carga real nem do id 1):
a dívida pela API e as 13 parcelas pelo mesmo serviço da carga (`set_schedule`).
"""

import datetime as dt
import re
from collections.abc import Callable

import pytest
from e2e_support import Env, assert_layout
from playwright.sync_api import BrowserContext, Page, expect
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from finance_api.ai.context import today_sp
from finance_api.core.permissions import CurrentUser, Owner
from finance_api.db.models import Debt
from finance_api.debts.installments import InstallmentSpec, set_schedule

pytestmark = pytest.mark.e2e

FACE = 141757
LAST_FACE = 141758
TOTAL = FACE * 12 + LAST_FACE  # 18.428,42, como no Nubank
ALL_DEVICES = ["iphone-11", "galaxy-a13", "desktop", "small-360"]


def money_re(cents: int) -> re.Pattern[str]:
    reais, resto = divmod(cents, 100)
    return re.compile(r"R\$\s*" + re.escape(f"{reais:,}".replace(",", ".") + f",{resto:02d}"))


def create_loan(context: BrowserContext, e2e_env: Env, label: str) -> int:
    """Dívida AMBOS pela API + 13 parcelas mensais a partir do mês que vem (dia 18)."""
    today = today_sp()
    resp = context.request.post(
        "/api/debts",
        data={
            "owner": "AMBOS",
            "name": f"Empréstimo e2e {label}",
            "principal_cents": 2265965,
            "monthly_rate": "0.0345",
            "installments": 13,
            "installment_cents": FACE,
            "start_date": today.isoformat(),
            "current_balance_cents": TOTAL,
        },
    )
    assert resp.ok, resp.text()
    debt_id = int(resp.json()["id"])

    specs = []
    for n in range(1, 14):
        total = today.year * 12 + (today.month - 1) + n
        specs.append(
            InstallmentSpec(
                number=n,
                due_date=dt.date(total // 12, total % 12 + 1, 18),
                face_cents=LAST_FACE if n == 13 else FACE,
            )
        )
    engine = create_engine(e2e_env.db_url)
    try:
        with sessionmaker(bind=engine, expire_on_commit=False)() as db:
            debt = db.scalar(select(Debt).where(Debt.id == debt_id))
            assert debt is not None
            user = CurrentUser(
                id=e2e_env.ids["user_matheus"], name="Matheus", role="admin", owner=Owner.MATHEUS
            )
            set_schedule(db, user, debt, specs, 818799, e2e_env.ids["account_matheus"], None)
            db.commit()
    finally:
        engine.dispose()
    return debt_id


def test_adiantar_a_ultima_parcela_mostra_adiantada_e_atualiza_o_restante(
    page: Page,
    context: BrowserContext,
    login_as: Callable[[str], None],
    e2e_env: Env,
    device: str,
) -> None:
    login_as("Matheus")
    debt_id = create_loan(context, e2e_env, device)

    page.goto(f"/dividas/{debt_id}")
    expect(page.get_by_role("heading", name=f"Empréstimo e2e {device}", level=1)).to_be_visible()
    resumo = page.get_by_role("region", name="Resumo do empréstimo")
    expect(resumo).to_contain_text("Restante a pagar")
    expect(resumo).to_contain_text(money_re(TOTAL))
    expect(resumo).to_contain_text(money_re(818799))  # total pago antes do app
    assert_layout(page)

    page.get_by_role("checkbox", name="Selecionar 13ª parcela").check()
    expect(page.get_by_role("region", name="Parcelas selecionadas")).to_be_visible()
    assert_layout(page)
    page.get_by_role("button", name="Revisar", exact=True).tap()

    form = page.get_by_role("form", name="Pagar parcelas")
    expect(form).to_be_visible()
    expect(form.get_by_label("Valor cobrado")).not_to_have_value("")
    expect(form.get_by_label("Conta")).to_have_value(str(e2e_env.ids["account_matheus"]))
    expect(form.get_by_label("Data")).not_to_have_value("")
    form.get_by_label("Valor cobrado").fill("1.000,00")  # o valor real cobrado, não a estimativa
    form.get_by_role("button", name="Confirmar pagamento").tap()

    expect(form).to_have_count(0)
    parcelas = page.get_by_role("list", name="Parcelas")
    expect(parcelas.get_by_text(re.compile(r"Adiantada em"))).to_have_count(1)
    expect(parcelas.get_by_role("checkbox", name="Selecionar 13ª parcela")).to_have_count(0)
    expect(resumo).to_contain_text(money_re(TOTAL - LAST_FACE))
    assert_layout(page)

    # Contas fixas lista só o que falta pagar: a parcela adiantada não é cobrada de novo. A tela não
    # mostra instância adiantada de mês futuro, então a conferência é pela API (estado "prepaid").
    resp = context.request.get("/api/bill-instances", params={"status": "prepaid", "limit": 200})
    assert resp.ok, resp.text()
    prepaid = [i for i in resp.json()["items"] if i.get("debt_id") == debt_id]
    assert len(prepaid) == 1, prepaid
    page.goto("/contas-fixas")
    expect(page.get_by_role("heading", name="Contas fixas", exact=True, level=1)).to_be_visible()
    assert_layout(page)


@pytest.mark.parametrize("device", ALL_DEVICES)
def test_tela_do_emprestimo_sem_rolagem_horizontal(
    page: Page,
    context: BrowserContext,
    login_as: Callable[[str], None],
    e2e_env: Env,
    device: str,
) -> None:
    login_as("Ruth")
    debt_id = create_loan(context, e2e_env, f"layout {device}")
    page.goto(f"/dividas/{debt_id}")
    expect(page.get_by_role("heading", name=re.compile("Empréstimo e2e"), level=1)).to_be_visible()
    expect(page.locator("[aria-busy='true']")).to_have_count(0)
    assert_layout(page)
    for n in (1, 13):
        page.get_by_role("checkbox", name=f"Selecionar {n}ª parcela").check()
    expect(page.get_by_role("region", name="Parcelas selecionadas")).to_be_visible()
    assert_layout(page)
    page.get_by_role("button", name="Revisar", exact=True).tap()
    expect(page.get_by_role("form", name="Pagar parcelas")).to_be_visible()
    assert_layout(page)
