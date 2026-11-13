"""Constantes e ajudantes do e2e (módulo à parte: os testes não importam de `conftest`)."""

from dataclasses import dataclass

from playwright.sync_api import Page

# PINs fictícios, só do banco descartável do e2e.
PINS = {"Matheus": "246810", "Ruth": "135790"}
WRONG_PIN = "999999"


@dataclass
class Env:
    base_url: str
    ids: dict[str, int]


def assert_layout(page: Page, *, tabbar: bool = True) -> None:
    """Sem rolagem horizontal e (fora do login) com a barra de abas visível na tela."""
    page.wait_for_load_state("networkidle")
    size = page.evaluate(
        "() => ({sw: document.scrollingElement.scrollWidth, iw: window.innerWidth})"
    )
    assert size["sw"] <= size["iw"], f"rolagem horizontal: {size}"
    if not tabbar:
        return
    bar = page.get_by_role("navigation", name="Principal")
    assert bar.is_visible(), "barra de abas invisível"
    box = bar.bounding_box()
    view = page.viewport_size
    assert box is not None and view is not None
    assert box["y"] >= 0 and box["y"] + box["height"] <= view["height"] + 1, (
        f"barra de abas fora da tela: {box}"
    )
