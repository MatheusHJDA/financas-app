"""Arquivos de exemplo gerados no teste (Pillow) ou lidos de `tests/fixtures/ai/`."""

import io
from pathlib import Path

from PIL import Image

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "ai"


def image_bytes(fmt: str = "PNG", size: tuple[int, int] = (64, 48), color="red") -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, fmt)
    return out.getvalue()


def scanned_pdf(pages: int = 1, size: tuple[int, int] = (300, 400)) -> bytes:
    """PDF "escaneado": só imagens, nenhum texto (Pillow grava cada página como JPEG)."""
    images = [Image.new("RGB", size, (200, 10 * i % 255, 30)) for i in range(pages)]
    out = io.BytesIO()
    images[0].save(out, "PDF", save_all=True, append_images=images[1:], resolution=72)
    return out.getvalue()


def digital_pdf() -> bytes:
    return (FIXTURES / "extrato_digital.pdf").read_bytes()
