"""Fluxos principais, cada um nos três aparelhos (414×896, 412×915 e computador 1280×800).

Fixture `device`. `open_route`/`tab` (em `e2e_support`) usam a barra de abas no celular e o menu
lateral no computador.
"""

import re
from collections.abc import Callable

import pytest
from e2e_support import (
    PINS,
    WRONG_PIN,
    Env,
    assert_layout,
    is_desktop,
    open_route,
    tab,
)
from playwright.sync_api import BrowserContext, Page, expect

pytestmark = pytest.mark.e2e

# Palavra sem dígitos por aparelho: a IA falsa lê o primeiro número do texto como o valor.
WORD = {"iphone-11": "iphone", "galaxy-a13": "galaxy", "desktop": "desktop"}

TABS = ("Início", "Transações", "Lançar com IA", "Relatórios", "Mais")
# Título (h1) de cada destino da barra; o chat tem h1 "Chat" só para leitores de tela.
TAB_HEADING = {
    "Transações": "Transações",
    "Lançar com IA": "Chat",
    "Relatórios": "Relatórios",
    "Mais": "Mais",
}


def tap_pin(page: Page, pin: str) -> None:
    for digit in pin:
        page.get_by_role("button", name=digit, exact=True).tap()


def transactions_total(context: BrowserContext, query: str) -> int:
    resp = context.request.get("/api/transactions", params={"q": query})
    assert resp.ok, resp.text()
    return int(resp.json()["total"])


# 1. Login ----------------------------------------------------------------------------------------


@pytest.mark.parametrize("user", ["Ruth", "Matheus"])
def test_login_pin_errado_mostra_erro_e_pin_certo_entra_no_chat(
    page: Page, e2e_env: Env, user: str
) -> None:
    page.goto("/")
    expect(page).to_have_url(re.compile(r"/login$"))
    expect(page.get_by_label("Seu nome")).to_be_visible()
    assert_layout(page, tabbar=False)

    page.get_by_label("Seu nome").fill(user)
    tap_pin(page, WRONG_PIN)
    expect(page.get_by_text("Não foi possível entrar. Confira o nome e o PIN.")).to_be_visible()
    expect(page).to_have_url(re.compile(r"/login$"))

    tap_pin(page, PINS[user])
    expect(page).not_to_have_url(re.compile(r"/login"))
    expect(page.get_by_role("heading", name="Início", exact=True)).to_be_visible()
    assert_layout(page)


# 2. Chat → confirmar -----------------------------------------------------------------------------


def test_chat_rascunho_so_grava_ao_confirmar_e_aparece_em_movimentacoes(
    page: Page, context: BrowserContext, login_as: Callable[[str], None], device: str
) -> None:
    login_as("Ruth")
    description = f"Mercado do bairro {WORD[device]}"
    page.goto("/")
    tab(page, "Lançar com IA")
    expect(page.get_by_role("region", name="Chat de lançamentos")).to_be_visible()

    page.get_by_label("Mensagem").fill(f"{description} 45,90 no Nubank Ruth")
    page.get_by_role("button", name="Enviar").tap()

    draft = page.get_by_role("article", name=re.compile(re.escape(description)))
    expect(draft).to_be_visible()
    expect(draft.get_by_text("R$ 45,90")).to_be_visible()
    expect(draft.get_by_text("Nubank Ruth")).to_be_visible()
    assert transactions_total(context, description) == 0, "gravou antes do toque em Confirmar"
    assert_layout(page)

    draft.get_by_role("button", name=f"Confirmar {description}").tap()
    expect(draft.get_by_text("✓ Confirmado")).to_be_visible()
    assert transactions_total(context, description) == 1

    tab(page, "Transações")
    expect(page.get_by_role("heading", name="Movimentações")).to_be_visible()
    expect(page.get_by_text(description, exact=True)).to_be_visible()
    assert_layout(page)


# 3. Geral ----------------------------------------------------------------------------------------


def owner_filter(page: Page, label: str) -> None:
    page.get_by_role("group", name="Dono").get_by_text(label, exact=True).tap()


def test_geral_saldos_e_filtros_por_dono(page: Page, login_as: Callable[[str], None]) -> None:
    login_as("Ruth")
    open_route(page, "/")
    expect(page.get_by_role("heading", name="Saldos")).to_be_visible()
    expect(page.get_by_text("Total do casal", exact=True)).to_be_visible()
    page.get_by_role("button", name="Expandir").tap()
    matheus = page.get_by_role("group", name="Saldos de Matheus")
    expect(matheus).to_contain_text("Nubank Matheus")
    expect(matheus).to_contain_text("R$ 1.450,00")
    expect(page.get_by_role("group", name="Saldos de Ruth")).to_contain_text("Nubank Ruth")
    ambos = page.get_by_role("group", name="Saldos de Ambos")
    expect(ambos).to_contain_text("Reserva do Casal")
    expect(ambos).to_contain_text("R$ 4.800,00")
    assert_layout(page)

    open_route(page, "/transacoes")
    feira = page.get_by_text("Apoio Matheus: Feira", exact=True)
    padaria = page.get_by_text("Apoio Ruth: Padaria", exact=True)
    condominio = page.get_by_text("Apoio Ambos: Condomínio", exact=True)
    for item in (feira, padaria, condominio):
        expect(item).to_be_visible()

    owner_filter(page, "Ruth")
    expect(padaria).to_be_visible()
    expect(feira).to_have_count(0)
    expect(condominio).to_have_count(0)

    owner_filter(page, "Matheus")
    expect(feira).to_be_visible()
    expect(padaria).to_have_count(0)
    expect(condominio).to_have_count(0)

    owner_filter(page, "Ambos")
    expect(condominio).to_be_visible()
    expect(feira).to_have_count(0)
    expect(padaria).to_have_count(0)
    assert_layout(page)


def test_geral_ruth_nao_edita_lancamento_do_matheus(
    page: Page, login_as: Callable[[str], None]
) -> None:
    login_as("Ruth")
    open_route(page, "/transacoes")
    expect(page.get_by_text("Apoio Matheus: Feira", exact=True)).to_be_visible()
    expect(page.get_by_role("button", name="Editar Apoio Ruth: Padaria")).to_be_visible()
    expect(page.get_by_role("button", name="Excluir Apoio Ruth: Padaria")).to_be_visible()
    expect(page.get_by_role("button", name="Editar Apoio Ambos: Condomínio")).to_be_visible()
    expect(page.get_by_role("button", name="Editar Apoio Matheus: Feira")).to_have_count(0)
    expect(page.get_by_role("button", name="Excluir Apoio Matheus: Feira")).to_have_count(0)


def test_geral_matheus_admin_edita_e_exclui_qualquer_lancamento(
    page: Page, login_as: Callable[[str], None]
) -> None:
    login_as("Matheus")
    open_route(page, "/transacoes")
    for description in ("Apoio Matheus: Feira", "Apoio Ruth: Padaria", "Apoio Ambos: Condomínio"):
        expect(page.get_by_role("button", name=f"Editar {description}")).to_be_visible()
        expect(page.get_by_role("button", name=f"Excluir {description}")).to_be_visible()


# 4. Metas ----------------------------------------------------------------------------------------


def test_metas_lista_com_progresso_e_cria_meta_de_acumular(
    page: Page, login_as: Callable[[str], None], device: str
) -> None:
    login_as("Ruth")
    open_route(page, "/metas")
    metas = page.get_by_role("list", name="Metas")
    expect(metas.get_by_role("heading", name="Reserva de emergência")).to_be_visible()
    expect(metas.get_by_role("heading", name="Viagem da Ruth")).to_be_visible()
    progress = page.get_by_role("progressbar", name="Progresso de Reserva de emergência")
    expect(progress).to_have_attribute("aria-valuenow", "48")  # 4.800,00 de 10.000,00
    assert_layout(page)

    name = f"Meta de acumular {WORD[device]}"
    page.get_by_role("button", name="Nova meta").tap()
    form = page.get_by_role("form", name="Nova meta")
    form.get_by_label("Nome da meta").fill(name)
    form.get_by_label("Valor-alvo (R$)").fill("1500,00")
    assert_layout(page)
    form.get_by_role("button", name="Criar meta").tap()

    expect(page.get_by_role("status").filter(has_text="Meta criada.")).to_be_attached()
    expect(metas.get_by_role("heading", name=name)).to_be_visible()
    expect(page.get_by_role("progressbar", name=f"Progresso de {name}")).to_be_visible()
    assert_layout(page)


# 5. Plano ----------------------------------------------------------------------------------------


def test_plano_resumo_mostra_quitacao_em_abril_de_2027(
    page: Page, login_as: Callable[[str], None]
) -> None:
    login_as("Ruth")
    open_route(page, "/plano")
    resumo = page.get_by_role("region", name=re.compile(r"^Resumo"))
    expect(resumo).to_be_visible()
    expect(resumo.get_by_text("Mês de quitação")).to_be_visible()
    expect(resumo).to_contain_text("abril de 2027")
    assert_layout(page)


# 6. Admin ----------------------------------------------------------------------------------------


def test_admin_bloqueado_para_a_ruth(
    page: Page, context: BrowserContext, login_as: Callable[[str], None]
) -> None:
    login_as("Ruth")
    open_route(page, "/mais")
    expect(page.get_by_text("Conectado como Ruth")).to_be_visible()
    expect(page.get_by_role("link", name="Administração")).to_have_count(0)
    assert_layout(page)

    open_route(page, "/admin/usuarios")
    expect(page).to_have_url(re.compile(r"/$"))
    expect(page.get_by_role("heading", name="Início", exact=True)).to_be_visible()
    expect(page.get_by_role("heading", name="Usuários", exact=True)).to_have_count(0)

    resp = context.request.get("/api/admin/users")
    assert resp.status == 403, resp.status


def test_admin_liberado_para_o_matheus(page: Page, login_as: Callable[[str], None]) -> None:
    login_as("Matheus")
    open_route(page, "/mais")
    link = page.get_by_role("link", name="Administração")
    expect(link).to_be_visible()
    link.tap()
    expect(page).to_have_url(re.compile(r"/admin/usuarios$"))
    expect(page.get_by_role("heading", name="Usuários", exact=True, level=1)).to_be_visible()
    secoes = {
        "configuracoes": "Configurações",
        "avisos": "Avisos do sistema",
        "ia": "IA",
        "auditoria": "Auditoria",
        "sistema": "Sistema",
    }
    for slug, title in secoes.items():
        open_route(page, f"/admin/{slug}")
        expect(page.get_by_role("heading", name=title, exact=True, level=1)).to_be_visible()
        assert_layout(page)


# 7. Todas as telas: sem rolagem horizontal e com a barra de abas ---------------------------------


@pytest.mark.parametrize("user", ["Ruth", "Matheus"])
def test_todas_as_abas_sem_rolagem_horizontal_e_com_barra_de_abas(
    page: Page, login_as: Callable[[str], None], user: str
) -> None:
    login_as(user)
    page.goto("/")
    expect(page.get_by_role("heading", name="Início", exact=True)).to_be_visible()
    assert_layout(page)
    for name in TABS[1:]:
        if name == "Mais" and is_desktop(page):
            continue  # o computador não tem a tela Mais na navegação (usa o menu lateral)
        tab(page, name)
        expect(
            page.get_by_role("heading", name=TAB_HEADING[name], exact=True).first
        ).to_be_attached()
        assert_layout(page)
    for name in ("Metas", "Plano", "Contas fixas", "Contas", "Preferências"):
        tab(page, name)
        expect(page.get_by_role("heading", name=name, exact=True, level=1)).to_be_visible()
        assert_layout(page)


# Recarregar/abrir direto uma rota do app (antes era 404; corrigido com o fallback de SPA) -----


def test_recarregar_rota_do_app_abre_a_tela(page: Page, login_as: Callable[[str], None]) -> None:
    login_as("Ruth")
    page.goto("/transacoes")
    expect(page.get_by_role("heading", name="Transações", exact=True)).to_be_visible()
    page.reload()
    expect(page.get_by_role("heading", name="Transações", exact=True)).to_be_visible()
    # endereço antigo continua valendo: /geral leva ao Início
    page.goto("/geral")
    expect(page.get_by_role("heading", name="Início", exact=True)).to_be_visible()
    # rota de admin aberta direto pela Ruth: o app carrega e o roteador a manda para o Início
    page.goto("/admin/ia")
    expect(page).to_have_url(re.compile(r"/$"))
