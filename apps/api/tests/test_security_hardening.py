"""Cabeçalhos de segurança, docs desligadas por padrão e Host confiável (sem banco)."""

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.responses import PlainTextResponse
from starlette.routing import Route

from finance_api.core.config import Settings
from finance_api.main import create_app

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; "
    "manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; "
    "object-src 'none'"
)


@pytest.fixture(autouse=True)
def _sem_hosts_do_ambiente(monkeypatch: pytest.MonkeyPatch) -> None:
    # o conftest raiz libera "testserver" por ALLOWED_HOSTS; aqui valem os padrões de verdade
    monkeypatch.delenv("ALLOWED_HOSTS", raising=False)


def settings(**overrides: object) -> Settings:
    return Settings(_env_file=None, **overrides)  # type: ignore[call-arg]


def build(web_dist: Path, **overrides: object) -> FastAPI:
    return create_app(web_dist=web_dist, start_scheduler=False, settings=settings(**overrides))


def make_client(tmp_path: Path, **overrides: object) -> TestClient:
    (tmp_path / "index.html").write_text("<html>pwa</html>", encoding="utf-8")
    return TestClient(build(tmp_path, **overrides), base_url="http://localhost")


# --- 4. cabeçalhos em todas as respostas ---------------------------------------------------------


@pytest.mark.parametrize("path", ["/api/health", "/", "/geral", "/api/nao-existe", "/x.js"])
def test_todas_as_respostas_levam_os_cabecalhos(tmp_path: Path, path: str) -> None:
    resp = make_client(tmp_path).get(path)
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["x-frame-options"] == "DENY"
    assert resp.headers["referrer-policy"] == "same-origin"
    assert resp.headers["content-security-policy"] == CSP


def test_host_recusado_tambem_leva_os_cabecalhos(tmp_path: Path) -> None:
    resp = make_client(tmp_path).get("/api/health", headers={"host": "evil.example"})
    assert resp.status_code == 400
    assert resp.headers["x-content-type-options"] == "nosniff"


def test_nao_sobrescreve_cabecalho_que_a_rota_ja_define(tmp_path: Path) -> None:
    own = {"Content-Security-Policy": "default-src 'none'", "X-Frame-Options": "SAMEORIGIN"}
    app = build(tmp_path / "x")
    route = Route("/api/custom", lambda _r: PlainTextResponse("ok", headers=own))
    app.router.routes.insert(0, route)
    resp = TestClient(app, base_url="http://localhost").get("/api/custom")
    assert resp.headers["content-security-policy"] == "default-src 'none'"
    assert resp.headers["x-frame-options"] == "SAMEORIGIN"
    assert resp.headers["referrer-policy"] == "same-origin"  # o que a rota não definiu entra


# --- 5. docs desligadas por padrão ---------------------------------------------------------------


@pytest.mark.parametrize(
    "path", ["/api/docs", "/api/openapi.json", "/api/redoc", "/docs", "/redoc"]
)
def test_docs_desligadas_por_padrao(tmp_path: Path, path: str) -> None:
    assert settings().enable_docs is False
    client = TestClient(build(tmp_path / "x"), base_url="http://localhost")
    assert client.get(path).status_code == 404


def test_docs_ligadas_por_configuracao(tmp_path: Path) -> None:
    client = TestClient(build(tmp_path / "x", enable_docs=True), base_url="http://localhost")
    assert client.get("/api/openapi.json").status_code == 200
    docs = client.get("/api/docs")
    assert docs.status_code == 200
    # a página do Swagger carrega script/estilo de CDN: só ela fica sem a CSP do app
    assert "content-security-policy" not in docs.headers
    assert docs.headers["x-frame-options"] == "DENY"
    assert client.get("/api/health").headers["content-security-policy"] == CSP


def test_schema_continua_disponivel_por_app_openapi(tmp_path: Path) -> None:
    schema = build(tmp_path / "x").openapi()
    assert "/api/health" in schema["paths"]


# --- 6. hosts confiáveis -------------------------------------------------------------------------


def test_hosts_padrao() -> None:
    assert settings().allowed_hosts_list == ["localhost", "127.0.0.1", "*.ts.net"]


def test_hosts_lista_separada_por_virgula_com_espacos() -> None:
    assert settings(allowed_hosts=" a.com , b.com,,").allowed_hosts_list == ["a.com", "b.com"]


@pytest.mark.parametrize(
    ("host", "status"),
    [
        ("localhost", 200),
        ("localhost:8000", 200),
        ("127.0.0.1:8000", 200),
        ("meu-pc.tail6cabb8.ts.net", 200),
        ("evil.example", 400),
        ("evil.example:8000", 400),
        ("ts.net.evil.example", 400),
        ("testserver", 400),
    ],
)
def test_host_header(tmp_path: Path, host: str, status: int) -> None:
    resp = make_client(tmp_path).get("/api/health", headers={"host": host})
    assert resp.status_code == status


def test_hosts_configuraveis(tmp_path: Path) -> None:
    client = make_client(tmp_path, allowed_hosts="financas.exemplo.com")
    assert client.get("/api/health", headers={"host": "financas.exemplo.com"}).status_code == 200
    assert client.get("/api/health", headers={"host": "localhost"}).status_code == 400
