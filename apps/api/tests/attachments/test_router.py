"""`GET /attachments/{id}`: qualquer usuário logado; 404 se não existe ou fora do upload_dir."""

import datetime as dt
from pathlib import Path

from sqlalchemy.orm import Session

from finance_api.attachments.storage import PNG, save_attachment
from finance_api.core.permissions import CurrentUser
from finance_api.db.models import Attachment

from .samples import image_bytes


def test_any_logged_user_downloads(
    db: Session, users: dict[str, CurrentUser], upload_dir: Path, use_settings, client_as
) -> None:
    data = image_bytes("PNG")
    attachment = save_attachment(
        db, users["matheus"], data, PNG, upload_dir, today=dt.date(2026, 11, 12)
    )

    response = client_as(users["ruth"]).get(f"/api/attachments/{attachment.id}")
    assert response.status_code == 200
    assert response.content == data
    assert response.headers["content-type"] == "image/png"
    assert response.headers["x-content-type-options"] == "nosniff"
    # o anexo é conteúdo do usuário: CSP própria (a do app não vale aqui) e abre inline
    assert response.headers["content-security-policy"] == "default-src 'none'"
    assert response.headers["content-disposition"].startswith("inline")


def test_requires_login(db: Session, users, upload_dir: Path, use_settings, client_as) -> None:
    attachment = save_attachment(
        db, users["ruth"], image_bytes(), PNG, upload_dir, today=dt.date(2026, 11, 12)
    )
    assert client_as(None).get(f"/api/attachments/{attachment.id}").status_code == 401


def test_missing_is_404(db: Session, users, use_settings, client_as) -> None:
    assert client_as(users["ruth"]).get("/api/attachments/999999").status_code == 404


def test_path_outside_upload_dir_is_404(
    db: Session, users, upload_dir: Path, use_settings, client_as
) -> None:
    secret = upload_dir.parent / "fora.txt"
    secret.write_text("não deveria sair", encoding="utf-8")
    row = Attachment(user_id=users["ruth"].id, path="../fora.txt", mime="text/plain", size=1)
    row.sha256 = "0" * 64
    db.add(row)
    db.flush()

    response = client_as(users["ruth"]).get(f"/api/attachments/{row.id}")
    assert response.status_code == 404
    assert "deveria" not in response.text


def test_file_missing_on_disk_is_404(db: Session, users, use_settings, client_as) -> None:
    row = Attachment(
        user_id=users["ruth"].id, path="2026/11/" + "a" * 64 + ".png", mime="image/png", size=1
    )
    row.sha256 = "a" * 64
    db.add(row)
    db.flush()
    assert client_as(users["ruth"]).get(f"/api/attachments/{row.id}").status_code == 404
