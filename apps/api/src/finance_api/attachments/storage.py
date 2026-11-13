"""Tipo pelo conteúdo, gravação em `upload_dir/AAAA/MM/<sha256>.<ext>` e leitura segura.

O nome do arquivo nunca vem do cliente: só o sha256 do conteúdo e a extensão do tipo detectado.
"""

import datetime as dt
import hashlib
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from finance_api.core.permissions import CurrentUser
from finance_api.db.models import Attachment

CHUNK_BYTES = 1024 * 1024
HEIF_BRANDS = frozenset({b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1"})


@dataclass(frozen=True)
class FileKind:
    mime: str
    ext: str

    @property
    def is_pdf(self) -> bool:
        return self.mime == "application/pdf"


JPEG = FileKind("image/jpeg", "jpg")
PNG = FileKind("image/png", "png")
WEBP = FileKind("image/webp", "webp")
HEIC = FileKind("image/heic", "heic")
PDF = FileKind("application/pdf", "pdf")


def detect_kind(data: bytes) -> FileKind | None:
    """Tipo pelos primeiros bytes (magic bytes). `None` = tipo não aceito."""
    if data.startswith(b"\xff\xd8\xff"):
        return JPEG
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return PNG
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return WEBP
    if data[4:8] == b"ftyp" and data[8:12] in HEIF_BRANDS:
        return HEIC
    if data.startswith(b"%PDF-"):
        return PDF
    return None


def read_limited(stream: BinaryIO, max_bytes: int) -> bytes:
    """Lê o upload inteiro; passou de `max_bytes` → 413 (nada é gravado)."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = stream.read(CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            limit_mb = max_bytes / (1024 * 1024)
            raise HTTPException(
                status.HTTP_413_CONTENT_TOO_LARGE,
                f"Arquivo maior que o limite de {limit_mb:g} MB.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


def require_kind(data: bytes) -> FileKind:
    if not data:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Arquivo vazio.")
    kind = detect_kind(data)
    if kind is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Tipo de arquivo não aceito. Envie foto (JPEG, PNG, WEBP, HEIC) ou PDF.",
        )
    return kind


def save_attachment(
    db: Session,
    user: CurrentUser,
    data: bytes,
    kind: FileKind,
    upload_dir: str | Path,
    *,
    today: dt.date,
) -> Attachment:
    """Grava o arquivo (se ainda não existir o mesmo conteúdo) e a linha em `attachments`.

    Faz flush, não commit.
    """
    digest = hashlib.sha256(data).hexdigest()
    relative = Path(f"{today.year:04d}") / f"{today.month:02d}" / f"{digest}.{kind.ext}"
    target = Path(upload_dir) / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        # Temporário único: dois envios simultâneos do mesmo arquivo não colidem.
        temp = target.with_name(f"{target.name}.{uuid.uuid4().hex}.tmp")
        temp.write_bytes(data)
        temp.replace(target)
    attachment = Attachment(
        user_id=user.id,
        path=relative.as_posix(),
        mime=kind.mime,
        size=len(data),
        sha256=digest,
    )
    db.add(attachment)
    db.flush()
    return attachment


def resolve_path(upload_dir: str | Path, stored_path: str) -> Path | None:
    """Caminho do disco do anexo, só se ficar dentro de `upload_dir` (senão `None`)."""
    root = Path(upload_dir).resolve()
    candidate = (root / stored_path).resolve()
    if not candidate.is_relative_to(root) or candidate == root:
        return None
    return candidate
