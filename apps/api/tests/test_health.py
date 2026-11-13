from pathlib import Path

from fastapi.testclient import TestClient

from finance_api.main import create_app


def test_health_ok() -> None:
    client = TestClient(create_app(start_scheduler=False))
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert isinstance(body["version"], str) and body["version"]


def test_api_routes_win_over_static_mount(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<html>pwa</html>", encoding="utf-8")
    client = TestClient(create_app(web_dist=tmp_path, start_scheduler=False))
    assert client.get("/api/health").json()["status"] == "ok"
    assert "pwa" in client.get("/").text


def test_rota_do_app_devolve_o_index_e_api_e_arquivo_continuam_404(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<html>pwa</html>", encoding="utf-8")
    client = TestClient(create_app(web_dist=tmp_path, start_scheduler=False))
    for route in ("/geral", "/mais/admin", "/plano"):
        resp = client.get(route)
        assert resp.status_code == 200 and "pwa" in resp.text, route
    assert client.get("/api/nao-existe").status_code == 404
    assert client.get("/assets/nao-existe.js").status_code == 404
