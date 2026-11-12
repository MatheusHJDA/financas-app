from pathlib import Path

from fastapi.testclient import TestClient

from finance_api.main import create_app


def test_health_ok() -> None:
    client = TestClient(create_app())
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert isinstance(body["version"], str) and body["version"]


def test_api_routes_win_over_static_mount(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<html>pwa</html>", encoding="utf-8")
    client = TestClient(create_app(web_dist=tmp_path))
    assert client.get("/api/health").json()["status"] == "ok"
    assert "pwa" in client.get("/").text
