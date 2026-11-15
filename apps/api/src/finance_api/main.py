from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response
from starlette.types import Scope

from finance_api.accounts.router import router as accounts_router
from finance_api.admin.router import router as admin_router
from finance_api.auth.router import router as auth_router
from finance_api.bills.router import router as bills_router
from finance_api.categories.router import router as categories_router
from finance_api.debts.router import router as debts_router
from finance_api.goals.router import router as goals_router
from finance_api.health.router import router as health_router
from finance_api.ingest.router import router as ingest_router
from finance_api.notifications import lifecycle as notifications_lifecycle
from finance_api.notifications.router import router as notifications_router
from finance_api.overview.router import router as overview_router
from finance_api.plan.router import router as plan_router
from finance_api.reports.router import router as reports_router
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
    notifications_router,  # U7 (/push, /admin/notifications/test, /admin/push-subscriptions)
    admin_router,  # U9 (/admin/*)
    plan_router,  # U10 (/plan/*)
    reports_router,  # U14 (/reports/month)
)


class SpaStaticFiles(StaticFiles):
    """Arquivos do PWA com fallback de SPA: rota do app (ex.: /geral, F5) devolve o index.html.

    Só para caminhos sem extensão fora de /api; arquivo inexistente (ex.: /x.js) e /api/*
    continuam 404.
    """

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            last = path.rsplit("/", 1)[-1]
            if exc.status_code != 404 or path.startswith("api") or "." in last:
                raise
            return await super().get_response("index.html", scope)


def create_app(web_dist: Path | None = None, *, start_scheduler: bool = True) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if start_scheduler:
            notifications_lifecycle.startup()
        try:
            yield
        finally:
            if start_scheduler:
                notifications_lifecycle.shutdown()

    app = FastAPI(
        title="Finanças API",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    api = APIRouter(prefix="/api")
    for module_router in MODULE_ROUTERS:
        api.include_router(module_router)
    app.include_router(api)

    dist = web_dist if web_dist is not None else _find_web_dist()
    if dist is not None and dist.is_dir():
        # Montado depois das rotas /api para não escondê-las.
        app.mount("/", SpaStaticFiles(directory=dist, html=True), name="web")
    return app


def _find_web_dist() -> Path | None:
    # /app/web_dist: copiado pelo Dockerfile; apps/web/dist: build local do PWA.
    for candidate in (Path("/app/web_dist"), Path(__file__).resolve().parents[3] / "web" / "dist"):
        if candidate.is_dir():
            return candidate
    return None


app = create_app()
