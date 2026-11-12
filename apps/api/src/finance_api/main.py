from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.staticfiles import StaticFiles

from finance_api.health.router import router as health_router


def create_app(web_dist: Path | None = None) -> FastAPI:
    app = FastAPI(title="Finanças API", docs_url="/api/docs", openapi_url="/api/openapi.json")

    api = APIRouter(prefix="/api")
    api.include_router(health_router)
    app.include_router(api)

    dist = web_dist if web_dist is not None else _find_web_dist()
    if dist is not None and dist.is_dir():
        # Montado depois das rotas /api para não escondê-las.
        app.mount("/", StaticFiles(directory=dist, html=True), name="web")
    return app


def _find_web_dist() -> Path | None:
    # /app/web_dist: copiado pelo Dockerfile; apps/web/dist: build local do PWA.
    for candidate in (Path("/app/web_dist"), Path(__file__).resolve().parents[3] / "web" / "dist"):
        if candidate.is_dir():
            return candidate
    return None


app = create_app()
