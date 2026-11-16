from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from finance_api.accounts.router import router as accounts_router
from finance_api.admin.router import router as admin_router
from finance_api.auth.router import router as auth_router
from finance_api.bills.router import router as bills_router
from finance_api.categories.router import router as categories_router
from finance_api.core.config import Settings, get_settings
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


# CSP do app: tudo do próprio domínio. `style-src 'unsafe-inline'` cobre os `style=` do React;
# `img-src data: blob:` cobre prévias de anexo; o PWA não usa script/estilo inline nem CDN.
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; "
    "manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; "
    "object-src 'none'"
)
SECURITY_HEADERS = (
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "DENY"),
    ("Referrer-Policy", "same-origin"),
    ("Content-Security-Policy", CONTENT_SECURITY_POLICY),
)
DOCS_URL = "/api/docs"


class SecurityHeadersMiddleware:
    """Cabeçalhos de segurança em toda resposta HTTP, sem sobrescrever os que a rota já definiu.

    ASGI puro (sem BaseHTTPMiddleware), para não mexer no streaming de arquivos.
    `csp_exempt_paths`: a página do Swagger usa script/estilo de CDN e não roda com a CSP do app.
    """

    def __init__(self, app: ASGIApp, csp_exempt_paths: frozenset[str] = frozenset()) -> None:
        self.app = app
        self.csp_exempt_paths = csp_exempt_paths

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        skip_csp = scope["path"] in self.csp_exempt_paths

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in SECURITY_HEADERS:
                    if name in headers or (skip_csp and name == "Content-Security-Policy"):
                        continue
                    headers.append(name, value)
            await send(message)

        await self.app(scope, receive, send_with_headers)


def create_app(
    web_dist: Path | None = None,
    *,
    start_scheduler: bool = True,
    settings: Settings | None = None,
) -> FastAPI:
    settings = settings or get_settings()

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
        docs_url=DOCS_URL if settings.enable_docs else None,
        openapi_url="/api/openapi.json" if settings.enable_docs else None,
        redoc_url=None,
        lifespan=lifespan,
    )
    # O último adicionado fica por fora: os cabeçalhos entram até na resposta 400 de Host inválido.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts_list)
    app.add_middleware(
        SecurityHeadersMiddleware,
        csp_exempt_paths=frozenset({DOCS_URL}) if settings.enable_docs else frozenset(),
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
