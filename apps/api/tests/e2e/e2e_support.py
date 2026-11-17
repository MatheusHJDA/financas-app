"""Constantes e ajudantes do e2e (módulo à parte: os testes não importam de `conftest`)."""

from dataclasses import dataclass

from playwright.sync_api import Locator, Page, expect

# PINs fictícios, só do banco descartável do e2e.
PINS = {"Matheus": "246810", "Ruth": "135790"}
WRONG_PIN = "999999"

# Breakpoint único do layout (`--bp-desktop`): a partir daqui vale o menu lateral.
DESKTOP_MIN_WIDTH = 1024


@dataclass
class Env:
    base_url: str
    ids: dict[str, int]
    db_url: str = ""  # banco descartável do e2e (para preparar dados que a API não cria)


def is_desktop(page: Page) -> bool:
    view = page.viewport_size
    assert view is not None
    return view["width"] >= DESKTOP_MIN_WIDTH


def shell_nav(page: Page) -> Locator:
    """A navegação principal do layout atual: barra "Principal" (celular) ou menu lateral."""
    name = "Menu lateral" if is_desktop(page) else "Principal"
    return page.get_by_role("navigation", name=name)


# No menu lateral o Início se chama Dashboard.
_SIDEBAR_NAME = {"Início": "Dashboard"}


def tab(page: Page, name: str) -> None:
    """Toca um destino pelo menu do layout atual.

    Celular: direto na barra Principal ou, se não estiver nela, pela tela Mais.
    Computador: link do menu lateral (Preferências fica no rodapé do menu, fora do <nav>).
    """
    if is_desktop(page):
        aside = page.get_by_role("complementary")
        expect(shell_nav(page)).to_be_visible()
        aside.get_by_role("link", name=_SIDEBAR_NAME.get(name, name), exact=True).tap()
        return
    bar = page.get_by_role("navigation", name="Principal")
    expect(bar.get_by_role("link", name="Mais", exact=True)).to_be_visible()
    link = bar.get_by_role("link", name=name, exact=True)
    if link.count() == 0:
        bar.get_by_role("link", name="Mais", exact=True).tap()
        expect(page.get_by_role("heading", name="Mais", exact=True)).to_be_visible()
        link = page.get_by_role("main").get_by_role("link", name=name, exact=True)
    link.tap()


def push_route(page: Page, path: str) -> None:
    """Troca de rota sem recarregar, pelo roteador, como um toque de link."""
    page.evaluate(
        "p => { history.pushState({}, '', p);"
        " window.dispatchEvent(new PopStateEvent('popstate')); }",
        path,
    )


def open_route(page: Page, path: str) -> None:
    """Carrega o app em "/" e vai à rota pelo roteador.

    `page.goto("/geral")` não serve para rotas fora de "/" quando se quer o fluxo de toque; para
    abrir direto/recarregar há `test_recarregar_rota_do_app_abre_a_tela`.
    """
    page.goto("/")
    expect(shell_nav(page)).to_be_visible()
    push_route(page, path)


def assert_layout(page: Page, *, tabbar: bool = True, idle: bool = True) -> None:
    """Sem rolagem horizontal e (fora do login) com a navegação visível na tela.

    Celular (< 1024px): barra flutuante "Principal" inteira dentro da tela.
    Computador: menu lateral visível e nenhuma barra de abas.
    `idle=False` quando o teste retém uma requisição de propósito (skeleton): não espera a rede.
    """
    if idle:
        page.wait_for_load_state("networkidle")
    size = page.evaluate(
        "() => ({sw: document.scrollingElement.scrollWidth, iw: window.innerWidth})"
    )
    assert size["sw"] <= size["iw"], f"rolagem horizontal: {size}"
    if not tabbar:
        return
    view = page.viewport_size
    assert view is not None
    if is_desktop(page):
        assert page.get_by_role("navigation", name="Menu lateral").is_visible(), (
            "menu lateral invisível"
        )
        assert page.get_by_role("navigation", name="Principal").count() == 0, (
            "barra de abas do celular apareceu no computador"
        )
        return
    bar = page.get_by_role("navigation", name="Principal")
    assert bar.is_visible(), "barra de abas invisível"
    box = bar.bounding_box()
    assert box is not None
    assert box["y"] >= 0 and box["y"] + box["height"] <= view["height"] + 1, (
        f"barra de abas fora da tela: {box}"
    )
    assert box["x"] >= 0 and box["x"] + box["width"] <= view["width"] + 1, (
        f"barra de abas estoura a largura: {box}"
    )
