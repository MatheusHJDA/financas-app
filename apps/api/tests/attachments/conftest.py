"""`upload_dir` em `tmp_path` e troca de `get_settings` na app."""

from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi import FastAPI

from finance_api.core.config import Settings, get_settings


@pytest.fixture
def upload_dir(tmp_path: Path) -> Path:
    path = tmp_path / "uploads"
    path.mkdir()
    return path


@pytest.fixture
def use_settings(app: FastAPI, upload_dir: Path) -> Callable[..., Settings]:
    """Troca `get_settings` da app (upload_dir em tmp_path; IA sem chave)."""

    def _use(**changes) -> Settings:
        values = {"upload_dir": str(upload_dir), "openai_api_key": "", "openai_model": ""}
        values.update(changes)
        settings = Settings(_env_file=None, **values)
        app.dependency_overrides[get_settings] = lambda: settings
        return settings

    _use()
    return _use
