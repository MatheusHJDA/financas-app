"""Fluxos do redesenho (spec 2026-11-14): Dashboard, olho, ✦, Relatórios, permissões e layout.

Rodam nos três aparelhos (fixture `device`: 414×896, 412×915 e computador 1280×800). Os testes de
layout pedem também o `small-360` (360×740) sobrescrevendo a fixture `device` por parametrização.
Seletores por papel e nome acessível; valores esperados vêm da própria API (o teste só formata).
"""

import datetime as dt
import re
from collections.abc import Callable

import pytest
from e2e_support import (
    Env,
    assert_layout,
    is_desktop,
    push_route,
    shell_nav,
    tab,
)
from playwright.sync_api import BrowserContext, Page, Route, expect

from finance_api.ai.context import today_sp

pytestmark = pytest.mark.e2e

MESES = (
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
)
ALL_DEVICES = ["iphone-11", "galaxy-a13", "desktop", "small-360"]
ADMIN_SECTIONS = {
    "usuarios": "Usuários",
    "configuracoes": "Configurações",
    "avisos": "Avisos do sistema",
    "ia": "IA",
    "auditoria": "Auditoria",
    "sistema": "Sistema",
}
# Rota -> título (h1). O chat tem h1 "Chat" só para leitores de tela.
ROUTES = {
    "/": "Início",
    "/transacoes": "Transações",
    "/lancar": "Chat",
    "/relatorios": "Relatórios",
    "/mais": "Mais",
    "/preferencias": "Preferências",
    "/contas-fixas": "Contas fixas",
    "/contas": "Contas",
    "/metas": "Metas",
    "/plano": "Plano",
}
ADMIN_ROUTES = {f"/admin/{slug}": title for slug, title in ADMIN_SECTIONS.items()}
MONEY = re.compile(r"\d{1,3}(?:\.\d{3})*,\d{2}")


def month_of(day: dt.date, delta: int = 0) -> tuple[int, int]:
    total = day.year * 12 + (day.month - 1) + delta
    return total // 12, total % 12 + 1


def month_label(year: int, month: int) -> str:
    return f"{MESES[month - 1]} de {year}"


def money_re(cents: int) -> re.Pattern[str]:
    """ "R$ 1.234,56" (o espaço do Intl pode ser NBSP). Só para valores não negativos."""
    reais, resto = divmod(cents, 100)
    return re.compile(r"R\$\s*" + re.escape(f"{reais:,}".replace(",", ".") + f",{resto:02d}"))


def api_report(context: BrowserContext, year: int, month: int) -> dict:
    resp = context.request.get("/api/reports/month", params={"month": f"{year}-{month:02d}"})
    assert resp.ok, resp.text()
    return resp.json()


def saldo_total(page: Page) -> str:
    """Texto do cartão Saldos (rótulo + total do casal), sem recalcular nada."""
    text = page.get_by_role("region", name="Saldos").inner_text()
    found = re.search(r"R\$\s*-?[\d.]+,\d{2}|R\$\s*•+", re.sub(r"\s+", " ", text))
    assert found, f"não achei o total do casal em: {text!r}"
    return found.group(0)


def go_to_each_route(page: Page, routes: dict[str, str]) -> None:
    for path, title in routes.items():
        push_route(page, path)
        expect(page.get_by_role("heading", name=title, exact=True, level=1).first).to_be_attached()
        expect(page.locator("[aria-busy='true']")).to_have_count(0)  # sem skeleton sobrando
        assert_layout(page)


# 1. Dashboard ------------------------------------------------------------------------------------


def test_dashboard_quatro_cartoes_e_troca_de_mes_sem_mudar_o_saldo(
    page: Page, context: BrowserContext, login_as: Callable[[str], None]
) -> None:
    login_as("Matheus")
    page.goto("/")
    expect(page.get_by_role("heading", name="Início", exact=True)).to_be_visible()
    expect(page.get_by_text("Olá, Matheus")).to_be_visible()

    today = today_sp()
    year, month = month_of(today)
    pyear, pmonth = month_of(today, -1)
    expect(page.get_by_text(month_label(year, month), exact=True)).to_be_visible()

    for card in ("Receitas", "Despesas", "Contas pagas", "A pagar"):
        expect(page.get_by_role("group", name=card, exact=True)).to_be_visible()
    now = api_report(context, year, month)
    assert now["expense_cents"] > 0, "a semente deveria ter despesas neste mês"
    expect(page.get_by_role("group", name="Despesas", exact=True)).to_contain_text(
        money_re(now["expense_cents"])
    )
    expect(page.get_by_role("group", name="Receitas", exact=True)).to_contain_text(
        money_re(now["income_cents"])
    )
    expect(page.get_by_role("group", name="Contas pagas", exact=True)).to_contain_text(
        re.compile(r"\d+ de \d+")
    )
    expect(page.get_by_role("button", name="Próximo mês")).to_be_disabled()
    assert_layout(page)

    saldo = saldo_total(page)
    assert MONEY.search(saldo), saldo

    # mês anterior: só os cartões do mês mudam; o saldo (agora) fica igual
    page.get_by_role("button", name="Mês anterior").tap()
    expect(page.get_by_text(month_label(pyear, pmonth), exact=True)).to_be_visible()
    before = api_report(context, pyear, pmonth)
    expect(page.get_by_role("group", name="Despesas", exact=True)).to_contain_text(
        money_re(before["expense_cents"])
    )
    expect(page.locator("[aria-busy='true']")).to_have_count(0)
    assert saldo_total(page) == saldo, "o saldo mudou ao trocar de mês"
    assert_layout(page)

    page.get_by_role("button", name="Próximo mês").tap()
    expect(page.get_by_text(month_label(year, month), exact=True)).to_be_visible()
    expect(page.get_by_role("group", name="Despesas", exact=True)).to_contain_text(
        money_re(now["expense_cents"])
    )
    assert saldo_total(page) == saldo


def test_dashboard_mes_sem_lancamentos_mostra_zeros_e_convite_sem_nan(
    page: Page, context: BrowserContext, login_as: Callable[[str], None]
) -> None:
    login_as("Ruth")
    page.goto("/")
    expect(page.get_by_role("heading", name="Início", exact=True)).to_be_visible()
    # volta alguns meses até um mês sem nada (a semente só tem lançamentos de hoje)
    for _ in range(3):
        page.get_by_role("button", name="Mês anterior").tap()
    expect(page.get_by_text("Nenhum lançamento neste mês")).to_be_visible()
    expect(page.get_by_role("link", name="Lance sua primeira despesa")).to_be_visible()
    expect(page.get_by_role("group", name="Despesas", exact=True)).to_contain_text(money_re(0))
    expect(page.locator("body")).not_to_contain_text("NaN")
    assert_layout(page)


# 2. Olho de ocultar valores ----------------------------------------------------------------------


def test_olho_oculta_valores_no_app_inteiro_e_persiste_apos_recarregar(
    page: Page, login_as: Callable[[str], None]
) -> None:
    login_as("Matheus")
    page.goto("/")
    saldos = page.get_by_role("region", name="Saldos")
    expect(saldos).to_contain_text(MONEY)

    page.get_by_role("button", name="Ocultar valores").tap()
    expect(page.get_by_role("button", name="Mostrar valores")).to_be_visible()
    expect(saldos).not_to_contain_text(MONEY)
    expect(saldos.get_by_role("img", name="Valor oculto")).to_be_visible()
    expect(page.get_by_role("group", name="Despesas", exact=True)).not_to_contain_text(MONEY)
    assert_layout(page)

    # vale em outra tela (estado global, sem recarregar)
    tab(page, "Transações")
    expect(page.get_by_role("heading", name="Transações", exact=True)).to_be_visible()
    expect(page.get_by_text("Apoio Matheus: Feira", exact=True)).to_be_visible()
    expect(page.get_by_role("img", name="Valor oculto").first).to_be_visible()
    expect(page.get_by_role("main")).not_to_contain_text(MONEY)

    # persiste ao recarregar
    page.goto("/")
    expect(page.get_by_role("button", name="Mostrar valores")).to_be_visible()
    expect(page.get_by_role("region", name="Saldos")).not_to_contain_text(MONEY)
    page.reload()
    expect(page.get_by_role("button", name="Mostrar valores")).to_be_visible()
    expect(page.get_by_role("region", name="Saldos")).not_to_contain_text(MONEY)

    # e volta a mostrar (também lembrado)
    page.get_by_role("button", name="Mostrar valores").tap()
    expect(page.get_by_role("region", name="Saldos")).to_contain_text(MONEY)
    page.reload()
    expect(page.get_by_role("button", name="Ocultar valores")).to_be_visible()
    expect(page.get_by_role("region", name="Saldos")).to_contain_text(MONEY)


# 3. ✦ abre o Lançar ------------------------------------------------------------------------------


def test_estrela_abre_o_lancar_com_ia_e_o_lancamento_a_mao(
    page: Page, login_as: Callable[[str], None]
) -> None:
    login_as("Ruth")
    page.goto("/")
    expect(page.get_by_role("heading", name="Início", exact=True)).to_be_visible()
    # celular: botão central da barra; computador: item "Lançar com IA" do menu lateral
    tab(page, "Lançar com IA")
    expect(page).to_have_url(re.compile(r"/lancar$"))
    expect(page.get_by_role("region", name="Chat de lançamentos")).to_be_visible()
    expect(page.get_by_label("Mensagem")).to_be_visible()
    assert_layout(page)

    page.get_by_role("button", name="Lançar à mão").tap()
    dialog = page.get_by_role("dialog", name="Lançar à mão")
    expect(dialog).to_be_visible()
    assert_layout(page)
    dialog.get_by_role("button", name="Fechar").tap()
    expect(dialog).to_have_count(0)
    expect(page.get_by_role("region", name="Chat de lançamentos")).to_be_visible()


# 4. Relatórios -----------------------------------------------------------------------------------


def test_relatorios_mostram_rosca_com_tabela_lista_e_mes_vazio(
    page: Page, login_as: Callable[[str], None]
) -> None:
    login_as("Matheus")
    page.goto("/")
    expect(page.get_by_role("heading", name="Início", exact=True)).to_be_visible()
    tab(page, "Relatórios")
    expect(page.get_by_role("heading", name="Relatórios", exact=True)).to_be_visible()

    for card in ("Receitas", "Saídas", "Balanço"):
        expect(page.get_by_role("group", name=card, exact=True)).to_be_visible()
    rosca = page.get_by_role("figure", name="Gastos por categoria")
    expect(rosca).to_be_visible()
    expect(rosca.locator("svg").first).to_be_visible()  # a rosca desenhada
    tabela = rosca.get_by_role("table")  # equivalente para leitor de tela (visually-hidden)
    expect(tabela).to_be_attached()
    expect(tabela.get_by_role("row", name=re.compile(r"^Mercado"))).to_be_attached()
    expect(tabela.get_by_role("row", name=re.compile(r"^Moradia"))).to_be_attached()
    categorias = page.get_by_role("list", name="Categorias")
    expect(categorias).to_contain_text("Mercado")
    expect(categorias).to_contain_text("Moradia")
    expect(categorias).to_contain_text("%")
    expect(page.get_by_role("figure", name="Ritmo de gasto")).to_be_visible()
    assert_layout(page)

    # mês passado: sem lançamentos -> zeros e convite, sem gráfico quebrado nem NaN
    page.get_by_role("button", name="Mês passado").tap()
    expect(page.get_by_text("Sem lançamentos neste período")).to_be_visible()
    convite = page.get_by_role("main").get_by_role("link", name="Lançar com IA")
    expect(convite).to_be_visible()
    expect(page.get_by_role("figure", name="Gastos por categoria")).to_have_count(0)
    expect(page.locator("body")).not_to_contain_text("NaN")
    assert_layout(page)

    page.get_by_role("button", name="Esse mês").tap()
    expect(page.get_by_role("figure", name="Gastos por categoria")).to_be_visible()


# 5. Ruth sem Administração -----------------------------------------------------------------------


def test_ruth_nao_ve_administracao_no_menu_nem_por_url(
    page: Page, context: BrowserContext, login_as: Callable[[str], None]
) -> None:
    login_as("Ruth")
    page.goto("/")
    expect(page.get_by_role("heading", name="Início", exact=True)).to_be_visible()
    # menu do layout atual
    nav = shell_nav(page)
    expect(nav).to_be_visible()
    if is_desktop(page):
        side = page.get_by_role("complementary")
        expect(side.get_by_role("link", name="Dashboard", exact=True)).to_be_visible()
        expect(side.get_by_text("Administração", exact=True)).to_have_count(0)
        for title in ADMIN_SECTIONS.values():
            expect(side.get_by_role("link", name=title, exact=True)).to_have_count(0)
    else:
        push_route(page, "/mais")
        expect(page.get_by_text("Conectado como Ruth")).to_be_visible()
        expect(page.get_by_role("link", name="Administração")).to_have_count(0)
    assert_layout(page)

    # URL direta, uma por seção: o app abre e o roteador devolve ao Início
    for slug in ADMIN_SECTIONS:
        page.goto(f"/admin/{slug}")
        expect(page).to_have_url(re.compile(r"/$"))
        expect(page.get_by_role("heading", name="Início", exact=True)).to_be_visible()
        for title in ADMIN_SECTIONS.values():
            expect(page.get_by_role("heading", name=title, exact=True, level=1)).to_have_count(0)
    resp = context.request.get("/api/admin/users")
    assert resp.status == 403, resp.status


def test_matheus_ve_administracao_no_menu_do_layout(
    page: Page, login_as: Callable[[str], None]
) -> None:
    login_as("Matheus")
    page.goto("/")
    expect(page.get_by_role("heading", name="Início", exact=True)).to_be_visible()
    if is_desktop(page):
        side = page.get_by_role("complementary")
        expect(side.get_by_text("Administração", exact=True)).to_be_visible()
        for title in ADMIN_SECTIONS.values():
            expect(side.get_by_role("link", name=title, exact=True)).to_be_visible()
        side.get_by_role("link", name="Auditoria", exact=True).tap()
        expect(page).to_have_url(re.compile(r"/admin/auditoria$"))
        expect(page.get_by_role("heading", name="Auditoria", exact=True, level=1)).to_be_visible()
    else:
        push_route(page, "/mais")
        expect(page.get_by_role("link", name="Administração")).to_be_visible()
    assert_layout(page)


# 6. Skeleton -------------------------------------------------------------------------------------


def hold_report(page: Page) -> list[Route]:
    """Segura `/api/reports/month` até o teste liberar (sem depender de tempo)."""
    held: list[Route] = []
    page.route(re.compile(r"/api/reports/month"), lambda route: held.append(route))
    return held


def wait_held(page: Page, held: list[Route]) -> None:
    for _ in range(100):
        if held:
            return
        page.wait_for_timeout(50)
    pytest.fail("a chamada de /api/reports/month não chegou")


def test_dashboard_mostra_skeleton_do_mes_e_troca_pelo_conteudo_sem_pular(
    page: Page, login_as: Callable[[str], None]
) -> None:
    login_as("Matheus")
    held = hold_report(page)
    page.goto("/")
    expect(page.get_by_role("heading", name="Início", exact=True)).to_be_visible()
    wait_held(page, held)

    skeleton = page.get_by_role("status", name="Carregando o mês")
    expect(skeleton).to_be_visible()
    expect(skeleton).to_have_attribute("aria-busy", "true")
    expect(page.get_by_role("group", name="Despesas", exact=True)).to_have_count(0)
    box_before = skeleton.bounding_box()
    assert box_before is not None
    assert_layout(page, idle=False)

    for route in held:
        route.continue_()
    expect(skeleton).to_have_count(0)
    despesas = page.get_by_role("group", name="Despesas", exact=True)
    expect(despesas).to_be_visible()
    receitas = page.get_by_role("group", name="Receitas", exact=True)
    box_after = receitas.bounding_box()
    assert box_after is not None
    # o skeleton ocupa o lugar dos cartões: o conteúdo não pula para outra posição
    assert abs(box_after["y"] - box_before["y"]) <= 8, (box_before, box_after)
    assert abs(box_after["x"] - box_before["x"]) <= 8, (box_before, box_after)
    assert_layout(page)


def test_relatorios_mostra_skeleton_e_troca_pelo_conteudo(
    page: Page, login_as: Callable[[str], None]
) -> None:
    login_as("Matheus")
    held = hold_report(page)
    page.goto("/relatorios")
    expect(page.get_by_role("heading", name="Relatórios", exact=True)).to_be_visible()
    wait_held(page, held)

    skeleton = page.get_by_role("status", name="Carregando relatório")
    expect(skeleton).to_be_visible()
    expect(page.get_by_role("figure", name="Gastos por categoria")).to_have_count(0)
    assert_layout(page, idle=False)

    for route in held:
        route.continue_()
    expect(skeleton).to_have_count(0)
    expect(page.get_by_role("figure", name="Gastos por categoria")).to_be_visible()


# 7. Layout: sem rolagem horizontal em TODAS as rotas (inclui 360px) -------------------------


@pytest.mark.parametrize("device", ALL_DEVICES)
@pytest.mark.parametrize("user", ["Ruth", "Matheus"])
def test_todas_as_rotas_sem_rolagem_horizontal(
    page: Page, login_as: Callable[[str], None], device: str, user: str
) -> None:
    login_as(user)
    page.goto("/")
    expect(page.get_by_role("heading", name="Início", exact=True)).to_be_visible()
    routes = dict(ROUTES)
    if user == "Matheus":
        routes.update(ADMIN_ROUTES)
    go_to_each_route(page, routes)


@pytest.mark.parametrize("device", ALL_DEVICES)
def test_valores_grandes_e_negativos_nao_estouram_o_layout(
    page: Page,
    context: BrowserContext,
    login_as: Callable[[str], None],
    e2e_env: Env,
    device: str,
) -> None:
    """R$ 1.234.567,89 positivo e negativo, e nome comprido: tudo cabe (inclusive em 360px).

    Fica por último no arquivo: cria contas que passam a fazer parte do banco da sessão.
    """
    login_as("Matheus")
    opening = (today_sp() - dt.timedelta(days=30)).isoformat()
    for name, cents in (
        (
            f"Conta de valor grande com um nome bem comprido para testar quebra ({device})",
            123456789,
        ),
        (f"Cheque especial estourado ({device})", -123456789),
    ):
        resp = context.request.post(
            "/api/accounts",
            data={
                "owner": "MATHEUS",
                "name": name,
                "type": "checking",
                "initial_balance_cents": cents,
                "initial_balance_date": opening,
            },
        )
        assert resp.ok, resp.text()

    page.goto("/")
    expect(page.get_by_role("heading", name="Início", exact=True)).to_be_visible()
    expect(page.locator("[aria-busy='true']")).to_have_count(0)
    expect(page.get_by_role("region", name="Saldos")).to_contain_text(MONEY)
    page.get_by_role("button", name="Expandir").tap()
    matheus = page.get_by_role("group", name="Saldos de Matheus")
    expect(matheus).to_contain_text("Cheque especial estourado")
    assert_layout(page)

    go_to_each_route(
        page,
        {"/contas": "Contas", "/transacoes": "Transações", "/relatorios": "Relatórios"},
    )


def test_computador_menu_lateral_e_cabecalho_ficam_fixos_ao_rolar(
    page: Page, login_as: Callable[[str], None]
) -> None:
    """Contas fixas no PC: ao rolar a página, o menu lateral e o cabeçalho não podem sumir."""
    if not is_desktop(page):
        pytest.skip("só o computador tem menu lateral")
    login_as("Matheus")
    page.goto("/contas-fixas")
    expect(page.get_by_role("heading", name="Contas fixas", exact=True, level=1)).to_be_visible()
    # Página longa de verdade, independente de quantas contas o banco de teste tem.
    page.evaluate(
        "document.querySelector('main').insertAdjacentHTML('beforeend',"
        " '<div style=\"height:3000px\"></div>')"
    )
    page.evaluate("() => window.scrollTo(0, 2000)")
    page.wait_for_timeout(300)
    assert page.evaluate("() => window.scrollY") > 1000
    top = page.evaluate(
        "() => [document.querySelector('.sidebar').getBoundingClientRect().top,"
        " document.querySelector('.topbar').getBoundingClientRect().top]"
    )
    assert top == [0, 0]


# 11. Puxar para atualizar (só celular) ------------------------------------------------------------

PULL_JS = """() => {
  const fire = (type, y) => {
    const t = new Touch({ identifier: 1, target: document.body, clientX: 200, clientY: y });
    const live = type === "touchend" ? [] : [t];
    window.dispatchEvent(
      new TouchEvent(type, { touches: live, changedTouches: [t], bubbles: true, cancelable: true }),
    );
  };
  fire("touchstart", 150);
  fire("touchmove", 200);
  fire("touchmove", 300);
  fire("touchend", 300);
}"""


@pytest.mark.parametrize("device", ["iphone-11", "galaxy-a13"])
def test_puxar_para_atualizar_no_inicio_refaz_o_overview(
    page: Page, login_as: Callable[[str], None]
) -> None:
    login_as("Matheus")
    page.goto("/")
    expect(page.get_by_role("heading", name="Início", exact=True)).to_be_visible()
    expect(page.locator("[aria-busy='true']")).to_have_count(0)
    with page.expect_request(
        lambda req: req.url.split("?")[0].endswith("/api/overview"), timeout=10_000
    ):
        page.evaluate(PULL_JS)
    expect(page.get_by_role("status").filter(has_text="Atualizando")).to_have_count(0)
