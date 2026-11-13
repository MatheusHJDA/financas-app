from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.staticfiles import StaticFiles

from finance_api.accounts.router import router as accounts_router
from finance_api.auth.router import router as auth_router
from finance_api.bills.router import router as bills_router
from finance_api.categories.router import router as categories_router
from finance_api.debts.router import router as debts_router
from finance_api.goals.router import router as goals_router
from finance_api.health.router import router as health_router
from finance_api.ingest.router import router as ingest_router
from finance_api.overview.router import router as overview_router
from finance_api.transactions.router import router as transactions_router

# Ligação dos módulos é do lead. Cada unidade só edita o `router.py` do próprio módulo
# (caminhos completos sem o prefixo /api, ex.: "/accounts"), nunca este arquivo.
MODULE_ROUTERS = (
    health_router,
    auth_router,  # U1
    accounts_router,  # U2
    categories_router,  # U2
    transactions_router,  # U2
    overview_router,  # U2
    bills_router,  # U4
    debts_router,  # U4
    goals_router,  # U4
    ingest_router,  # U5 (/ingest, /drafts, /attachments)
)


def create_app(web_dist: Path | None = None) -> FastAPI:
    app = FastAPI(title="Finanças API", docs_url="/api/docs", openapi_url="/api/openapi.json")

    api = APIRouter(prefix="/api")
    for module_router in MODULE_ROUTERS:
        api.include_router(module_router)
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
