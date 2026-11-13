# Contexto de build: raiz do repositório (veja infra/docker-compose.yml).
FROM node:22-alpine AS web
WORKDIR /web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy TZ=America/Sao_Paulo PYTHONUNBUFFERED=1
WORKDIR /app
COPY apps/api/pyproject.toml apps/api/uv.lock apps/api/.python-version ./
COPY apps/api/src ./src
COPY apps/api/alembic.ini ./alembic.ini
COPY apps/api/alembic ./alembic
RUN uv sync --frozen --no-dev
# main.py serve /app/web_dist em "/" depois das rotas /api, se existir.
COPY --from=web /web/dist ./web_dist
# Carga inicial: `docker compose ... exec api python -m finance_api.seed` (sem copiar arquivo).
COPY infra/seed/seed.yaml ./seed/seed.yaml
ENV SEED_FILE=/app/seed/seed.yaml
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn finance_api.main:app --host 0.0.0.0 --port 8000"]
