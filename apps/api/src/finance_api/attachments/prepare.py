"""Preparo do anexo para a IA (ORQUESTRACAO.md 6.2, passo 2).

- Imagem (JPEG/PNG/WEBP/HEIC) → JPEG reduzido (lado maior ≤ 2000 px), girado pelo EXIF.
- PDF digital → texto (`pypdf`).
- PDF escaneado (pouco texto) → imagens das primeiras páginas (`page.images`, até 5 páginas),
  reduzidas como as fotos.
Arquivo que não abre → 422 (o chamador ainda não gravou nada).
"""

import io
import warnings
from dataclasses import dataclass, field

import pillow_heif
from fastapi import HTTPException, status
from PIL import Image, ImageOps, UnidentifiedImageError
from pypdf import PdfReader
from pypdf.errors import PyPdfError

from finance_api.attachments.storage import FileKind

pillow_heif.register_heif_opener()

MAX_SIDE_PX = 2000
JPEG_QUALITY = 85
MAX_PDF_IMAGE_PAGES = 5
MAX_PDF_TEXT_PAGES = 30
MAX_TEXT_CHARS = 30_000
MIN_DIGITAL_TEXT_CHARS = 40  # menos que isso (sem espaços) = PDF escaneado


@dataclass
class PreparedInput:
    input_kind: str  # "image", "pdf_text" ou "pdf_scan" (vai para ai_extractions.input_kind)
    text: str | None = None
    images: list[bytes] = field(default_factory=list)


def _unreadable(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)


def to_ai_jpeg(image: Image.Image) -> bytes:
    """JPEG RGB com o lado maior ≤ 2000 px."""
    image = ImageOps.exif_transpose(image)
    if image.mode != "RGB":
        if image.mode in ("RGBA", "LA", "PA") or "transparency" in image.info:
            background = Image.new("RGB", image.size, "white")
            background.paste(image.convert("RGBA"), mask=image.convert("RGBA").getchannel("A"))
            image = background
        else:
            image = image.convert("RGB")
    image.thumbnail((MAX_SIDE_PX, MAX_SIDE_PX))
    out = io.BytesIO()
    image.save(out, "JPEG", quality=JPEG_QUALITY, optimize=True)
    return out.getvalue()


def _image_bytes_to_jpeg(data: bytes) -> bytes:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                image.load()
                return to_ai_jpeg(image)
    except (
        UnidentifiedImageError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        OSError,
        ValueError,
        SyntaxError,
    ):
        raise _unreadable("Não consegui abrir a imagem.") from None


def _pdf_reader(data: bytes) -> PdfReader:
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(""):
            raise _unreadable("PDF protegido por senha. Envie sem senha.")
        _ = len(reader.pages)
        return reader
    except HTTPException:
        raise
    except (PyPdfError, OSError, ValueError, KeyError, TypeError):
        raise _unreadable("Não consegui abrir o PDF.") from None


def _pdf_text(reader: PdfReader) -> str:
    parts: list[str] = []
    for page in reader.pages[:MAX_PDF_TEXT_PAGES]:
        try:
            parts.append(page.extract_text() or "")
        except (PyPdfError, OSError, ValueError, KeyError, TypeError):
            continue
    return "\n".join(p.strip() for p in parts if p.strip())[:MAX_TEXT_CHARS]


def _pdf_page_images(reader: PdfReader) -> list[bytes]:
    images: list[bytes] = []
    for page in reader.pages[:MAX_PDF_IMAGE_PAGES]:
        try:
            page_images = list(page.images)
        except (PyPdfError, OSError, ValueError, KeyError, TypeError):
            continue
        # A maior imagem da página costuma ser a página escaneada inteira.
        best = None
        for item in page_images:
            # Decodificar a imagem do PDF (arquivo do usuário) pode falhar de muitos jeitos
            # (stream truncado, filtro sem decodificador, bomba de descompressão): pula a imagem.
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("error", Image.DecompressionBombWarning)
                    pil = item.image
            except Exception:  # noqa: BLE001 - entrada não confiável; nunca vira 500
                continue
            if pil is None:
                continue
            if best is None or pil.width * pil.height > best.width * best.height:
                best = pil
        if best is not None:
            try:
                images.append(to_ai_jpeg(best))
            except Exception:  # noqa: BLE001 - idem
                continue
    return images


def prepare(data: bytes, kind: FileKind) -> PreparedInput:
    if not kind.is_pdf:
        return PreparedInput(input_kind="image", images=[_image_bytes_to_jpeg(data)])

    reader = _pdf_reader(data)
    text = _pdf_text(reader)
    if len("".join(text.split())) >= MIN_DIGITAL_TEXT_CHARS:
        return PreparedInput(input_kind="pdf_text", text=text)
    images = _pdf_page_images(reader)
    if not images:
        if text:
            return PreparedInput(input_kind="pdf_text", text=text)
        raise _unreadable("O PDF não tem texto nem imagens legíveis.")
    return PreparedInput(input_kind="pdf_scan", text=text or None, images=images)
