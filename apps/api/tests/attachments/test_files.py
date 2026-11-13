"""Tipo por magic bytes, limite de tamanho, gravação e preparo para a IA."""

import datetime as dt
import hashlib
import io
from pathlib import Path

import pytest
from fastapi import HTTPException
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from finance_api.attachments import prepare as prep
from finance_api.attachments.storage import (
    HEIC,
    JPEG,
    PDF,
    PNG,
    WEBP,
    detect_kind,
    read_limited,
    require_kind,
    resolve_path,
    save_attachment,
)
from finance_api.core.permissions import CurrentUser
from finance_api.db.models import Attachment

from .samples import digital_pdf, image_bytes, scanned_pdf


def _heic_bytes() -> bytes:
    out = io.BytesIO()
    try:
        Image.new("RGB", (80, 60), "blue").save(out, "HEIF")
    except (KeyError, OSError, ValueError) as error:  # wheel sem codificador HEIF
        pytest.skip(f"pillow-heif sem codificador: {error}")
    return out.getvalue()


def test_detect_kind_by_content_not_name() -> None:
    assert detect_kind(image_bytes("JPEG")) == JPEG
    assert detect_kind(image_bytes("PNG")) == PNG
    assert detect_kind(image_bytes("WEBP")) == WEBP
    assert detect_kind(scanned_pdf()) == PDF
    assert detect_kind(b"<html><script>alert(1)</script>") is None
    assert detect_kind(b"GIF89a....") is None
    assert detect_kind(b"\x00\x00\x00\x18ftypavif") is None


def test_detect_heic() -> None:
    assert detect_kind(_heic_bytes()) == HEIC


def test_require_kind_rejects_unknown_and_empty() -> None:
    for data in (b"", b"texto qualquer"):
        with pytest.raises(HTTPException) as caught:
            require_kind(data)
        assert caught.value.status_code == 422


def test_read_limited_413_over_limit() -> None:
    assert read_limited(io.BytesIO(b"x" * 100), 100) == b"x" * 100
    with pytest.raises(HTTPException) as caught:
        read_limited(io.BytesIO(b"x" * 101), 100)
    assert caught.value.status_code == 413


def test_image_is_reduced_to_jpeg_2000px() -> None:
    prepared = prep.prepare(image_bytes("PNG", size=(4000, 1000)), PNG)
    assert prepared.input_kind == "image"
    (jpeg,) = prepared.images
    with Image.open(io.BytesIO(jpeg)) as image:
        assert image.format == "JPEG"
        assert max(image.size) == 2000
        assert image.size == (2000, 500)


def test_small_image_keeps_size_and_transparency_becomes_white() -> None:
    out = io.BytesIO()
    Image.new("RGBA", (10, 10), (0, 0, 0, 0)).save(out, "PNG")
    (jpeg,) = prep.prepare(out.getvalue(), PNG).images
    with Image.open(io.BytesIO(jpeg)) as image:
        assert image.size == (10, 10)
        assert image.getpixel((5, 5)) == pytest.approx((255, 255, 255), abs=3)


def test_heic_becomes_jpeg() -> None:
    (jpeg,) = prep.prepare(_heic_bytes(), HEIC).images
    with Image.open(io.BytesIO(jpeg)) as image:
        assert image.format == "JPEG"
        assert image.size == (80, 60)


def test_broken_image_is_422() -> None:
    with pytest.raises(HTTPException) as caught:
        prep.prepare(b"\xff\xd8\xff" + b"lixo" * 10, JPEG)
    assert caught.value.status_code == 422


def test_digital_pdf_becomes_text() -> None:
    prepared = prep.prepare(digital_pdf(), PDF)
    assert prepared.input_kind == "pdf_text"
    assert prepared.images == []
    assert "Farmacia Exemplo" in prepared.text
    assert "-12,50" in prepared.text


def test_scanned_pdf_becomes_page_images_up_to_5() -> None:
    prepared = prep.prepare(scanned_pdf(pages=7), PDF)
    assert prepared.input_kind == "pdf_scan"
    assert len(prepared.images) == 5
    for jpeg in prepared.images:
        with Image.open(io.BytesIO(jpeg)) as image:
            assert image.format == "JPEG"


def test_broken_pdf_is_422() -> None:
    with pytest.raises(HTTPException) as caught:
        prep.prepare(b"%PDF-1.4\nnao e um pdf de verdade", PDF)
    assert caught.value.status_code == 422


def test_save_attachment_uses_hash_path(
    db: Session, users: dict[str, CurrentUser], upload_dir: Path
) -> None:
    data = image_bytes("PNG")
    digest = hashlib.sha256(data).hexdigest()
    first = save_attachment(db, users["ruth"], data, PNG, upload_dir, today=dt.date(2026, 3, 7))
    second = save_attachment(db, users["ruth"], data, PNG, upload_dir, today=dt.date(2026, 3, 7))

    assert first.path == f"2026/03/{digest}.png"
    assert (upload_dir / first.path).read_bytes() == data
    assert (first.mime, first.size, first.sha256, first.user_id) == (
        "image/png",
        len(data),
        digest,
        users["ruth"].id,
    )
    assert second.path == first.path  # mesmo conteúdo, mesmo arquivo
    assert [p.name for p in upload_dir.rglob("*") if p.is_file()] == [f"{digest}.png"]
    assert db.scalar(select(func.count(Attachment.id))) == 2


def test_resolve_path_stays_inside_upload_dir(upload_dir: Path) -> None:
    inside = resolve_path(upload_dir, "2026/03/abc.png")
    assert inside == (upload_dir / "2026" / "03" / "abc.png").resolve()
    assert resolve_path(upload_dir, "../fora.png") is None
    assert resolve_path(upload_dir, "2026/../../fora.png") is None
    assert resolve_path(upload_dir, str(upload_dir.parent / "fora.png")) is None
    assert resolve_path(upload_dir, "") is None


def test_scanned_pdf_with_undecodable_image_skips_it() -> None:
    """Imagem do PDF que não decodifica (stream quebrado, bomba) é pulada, nunca vira 500."""

    class Broken:
        @property
        def image(self):
            raise RuntimeError("stream truncado")

    good = Image.new("RGB", (300, 400), "white")

    class Good:
        image = good

    class Page:
        def __init__(self, items):
            self.images = items

    class Reader:
        pages = [Page([Broken()]), Page([Broken(), Good()])]

    images = prep._pdf_page_images(Reader())  # type: ignore[arg-type]
    assert len(images) == 1
    assert Image.open(io.BytesIO(images[0])).format == "JPEG"
