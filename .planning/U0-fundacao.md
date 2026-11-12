# U0 — Fundação: plano de passos (escrito pelo lead)

Fonte: `ORQUESTRACAO.md` seções 5, 7, 9 (U0) e 10; estado em `.planning/STATE.md`.
Siga os passos em ordem. Se um passo estiver errado ou impossível, **pare e reporte** (não improvise).

## Regras gerais
- Dinheiro sempre `BigInteger`/`int` em centavos. Datas: `date`; instantes: `timestamptz` (UTC no banco, fuso `America/Sao_Paulo` na apresentação).
- Nada de segredos em arquivos versionados. Só `.env.example` com valores fictícios/vazios.
- Sem bibliotecas pesadas no front (nada de MUI/Chakra/Antd, nada de lib de gráficos).
- Não crie código de funcionalidade das unidades U1–U13 (auth real, CRUDs, IA, telas). Só esqueleto, contratos e interfaces.

## Passo 1 — Raiz
Crie:
- `README.md` curto (o que é, como rodar `./tasks.ps1 check`, link para `ORQUESTRACAO.md`).
- `.env.example` com: `DATABASE_URL=postgresql+psycopg://financas:financas@db:5432/financas`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `OPENAI_API_KEY=`, `OPENAI_MODEL=`, `VAPID_PUBLIC_KEY=`, `VAPID_PRIVATE_KEY=`, `VAPID_SUBJECT=mailto:admin@example.com`, `INITIAL_PIN_MATHEUS=`, `INITIAL_PIN_RUTH=`, `TZ=America/Sao_Paulo`, `SESSION_DAYS=30`.
- `.gitattributes` com `* text=auto eol=lf` e `*.ps1 text eol=crlf`.
- Não mexa em `.gitignore`, `ORQUESTRACAO.md`, `.planning/**`, `.agents/**`, `.claude/**`, `docs/referencia/**`.
**Check:** os arquivos existem.

## Passo 2 — API (`apps/api/`)
Projeto `uv`:
- `pyproject.toml`: nome `finance-api`, `requires-python = ">=3.12,<3.13"`, layout `src/finance_api`. Dependências: `fastapi`, `uvicorn[standard]`, `pydantic>=2`, `pydantic-settings`, `sqlalchemy>=2`, `alembic`, `psycopg[binary]>=3`, `argon2-cffi`, `apscheduler>=3.10,<4`, `pywebpush`, `openai`, `pypdf`, `pillow`, `pillow-heif`, `python-multipart`. Dev (grupo `dev`): `pytest`, `httpx`, `ruff`, `openapi-spec-validator`, `pyyaml`. Config do ruff: `line-length = 100`, `target-version = "py312"`, regras `E,F,I,B,UP`. Config pytest: `testpaths = ["tests"]`, marcador `live` registrado e desligado por padrão (`addopts = "-m 'not live'"`).
- `.python-version` = `3.12`.
- `src/finance_api/__init__.py`, `main.py` com `create_app()` e `app = create_app()`; todas as rotas sob prefixo `/api`.
- `src/finance_api/core/config.py`: `Settings` (pydantic-settings) lendo as variáveis do `.env.example`; `get_settings()` com cache.
- `src/finance_api/health/router.py`: `GET /api/health` → `200 {"status": "ok", "version": "<versão do pacote>"}`. Não depende do banco (checagem de banco fica em `/api/admin/system`, U9).
- `src/finance_api/db/base.py` (`DeclarativeBase` com convenção de nomes de constraints), `db/session.py` (engine + `get_db` gerador de `Session`), `db/models.py` com **todas** as tabelas da seção 7 do ORQUESTRACAO.md, exatamente com os campos listados. Use enums Postgres nativos (`sqlalchemy.Enum(..., name=...)`) para: `user_role` (admin, member), `owner` (RUTH, MATHEUS, AMBOS), `account_type` (checking, savings, cash, meal_voucher, credit_card, loan), `category_kind` (income, expense), `tx_kind` (income, expense, transfer), `tx_status` (confirmed), `tx_source` (chat, manual, import), `draft_status` (pending, confirmed, discarded), `bill_status` (open, paid). Todo id é `BigInteger` identity, exceto `sessions.id` (string de 43+ chars, token aleatório — guardar só o hash: nomeie `token_hash`, PK `id` BigInteger) e `settings.key` (texto, PK). Inclua `created_at`/`updated_at` (timestamptz, default `now()`) nas tabelas de negócio. Índices: `transactions(date)`, `transactions(account_id, date)`, `transactions(owner)`, `transactions(dedupe_hash)`, `bill_instances(due_date, status)`, `audit_log(entity, entity_id)`, `push_subscriptions(endpoint)` único, `bill_instances(recurring_bill_id, month)` único. JSON em `JSONB`. `debts.monthly_rate` como `Numeric(8,6)`. FKs com `ON DELETE` coerente (RESTRICT para dinheiro; CASCADE para sessions/push_subscriptions do usuário).
- `src/finance_api/core/permissions.py` (**interface congelada para U1/U2/U4**):
  ```python
  class Owner(StrEnum): RUTH="RUTH"; MATHEUS="MATHEUS"; AMBOS="AMBOS"
  @dataclass(frozen=True)
  class CurrentUser: id: int; name: str; role: Literal["admin","member"]; owner: Owner  # owner = RUTH ou MATHEUS
  def can_write(user: CurrentUser, record_owner: Owner) -> bool:
      # admin pode tudo; AMBOS pode pelos dois; senão só o dono (D6/D12)
  def ensure_can_write(user, record_owner) -> None  # levanta HTTPException 403
  ```
  Implemente `can_write`/`ensure_can_write` de verdade (é regra pura) com testes.
- `src/finance_api/core/deps.py`: `get_current_user(request, db) -> CurrentUser` como **stub** que levanta `HTTPException(401)` com comentário `# U1 implementa`; `require_admin` que usa `get_current_user` e devolve 403 se não for admin.
- Alembic em `apps/api/alembic/` + `alembic.ini`; `env.py` lê `DATABASE_URL` das `Settings` e usa `Base.metadata`. Uma migração inicial `0001_initial` com o schema completo (pode ser autogerada a partir dos modelos, mas revise: enums criados uma vez, índices presentes).
- Testes em `apps/api/tests/`: `test_health.py` (200 e corpo), `test_permissions.py` (tabela: Ruth/Matheus/admin × RUTH/MATHEUS/AMBOS), `test_models.py` (todas as 17 tabelas da seção 7 existem em `Base.metadata`; colunas de dinheiro terminam em `_cents` e são inteiras), `test_migration_offline.py` (roda `alembic upgrade head --sql` via API do Alembic em modo offline e confere que o SQL contém `CREATE TABLE` para cada tabela), `test_openapi_contract.py` (passo 4).
- `apps/api/Dockerfile`: `python:3.12-slim`, instala com `uv sync --frozen --no-dev`, roda `alembic upgrade head` e depois `uvicorn finance_api.main:app --host 0.0.0.0 --port 8000`. Serve os estáticos de `apps/web/dist` em `/` se o diretório existir (montar `StaticFiles` com `html=True` **depois** das rotas `/api`).
**Check:** `cd apps/api; uv sync; uv run ruff check .; uv run ruff format --check .; uv run pytest` verdes.

## Passo 3 — PWA (`apps/web/`)
- Vite + React 18 + TypeScript (strict). Dependências: `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`. Dev: `vite`, `@vitejs/plugin-react`, `vite-plugin-pwa`, `typescript`, `eslint` (flat config, `typescript-eslint`, `eslint-plugin-react-hooks`), `vitest`, `@testing-library/react`, `jsdom`.
- `vite.config.ts`: `VitePWA` com `registerType: "autoUpdate"`, manifest `name: "Finanças"`, `short_name: "Finanças"`, `lang: "pt-BR"`, `display: "standalone"`, `start_url: "/"`, `theme_color` e `background_color` definidos, ícones 192, 512 e 512 maskable em `public/icons/` (gere PNGs simples, um "F" sobre fundo de cor sólida — pode ser via script Node sem dependência extra, ou SVG + PNG commitados). Proxy de dev `/api` → `http://localhost:8000`. Use `injectManifest` com `src/sw.ts` (U7 vai adicionar o handler de push nesse arquivo); por agora o SW só faz precache.
- `index.html` com `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`, `apple-mobile-web-app-capable`, `apple-touch-icon`, `theme-color`.
- `src/main.tsx` + `src/App.tsx`: QueryClientProvider + Router com uma única rota `/` mostrando "Finanças" e o status de `GET /api/health` (carregando / ok / erro). Nada mais.
- `src/styles/tokens.css` com variáveis CSS mínimas (cores, espaçamentos, raio, fonte do sistema) e `env(safe-area-inset-*)` no body.
- Teste `src/App.test.tsx` (vitest + jsdom) que renderiza o App com `fetch` simulado e vê "Finanças".
- `package.json` scripts: `dev`, `build` (`tsc -b && vite build`), `lint` (`eslint .`), `typecheck` (`tsc --noEmit -p .`), `test` (`vitest run`).
**Check:** `cd apps/web; npm install; npm run lint; npm run typecheck; npm test; npm run build` verdes; `dist/manifest.webmanifest` existe.

## Passo 4 — Contrato OpenAPI (`docs/api/openapi.yaml`)
OpenAPI 3.1, `servers: [{url: /api}]`, autenticação por cookie `session` (securityScheme `apiKey` in cookie). Componentes com schemas Pydantic-equivalentes (dinheiro `integer` com sufixo `_cents`; `Owner` enum). Erros padrão: `{"detail": string}`. Paginação de listas: `?limit=&offset=` e resposta `{items: [], total}`.
Endpoints (todos sob `/api`; marque `security: []` nos públicos):
- **health**: `GET /health` (público).
- **auth**: `GET /auth/users` (público; `[{id,name}]` para a tela de PIN), `POST /auth/login` `{user_id, pin, device_label}` → 200 + cookie / 401 / 423 bloqueado, `POST /auth/logout`, `GET /auth/me`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`.
- **accounts**: `GET /accounts`, `POST /accounts`, `GET|PATCH|DELETE /accounts/{id}`. `Account` inclui `current_balance_cents` (somente leitura).
- **categories**: `GET /categories`, `POST /categories`, `PATCH|DELETE /categories/{id}`.
- **transactions**: `GET /transactions` (filtros `owner`, `account_id`, `category_id`, `kind`, `date_from`, `date_to`, `q`, paginação), `POST /transactions` (manual), `GET|PATCH|DELETE /transactions/{id}`, `GET /transactions/export.csv` (mesmos filtros, `text/csv`).
- **overview**: `GET /overview` → saldos por conta agrupados por dono, totais por dono e do casal, faturas abertas de cartões, saldo devedor das dívidas, contas a pagar dos próximos 15 dias e vencidas.
- **bills**: `GET|POST /recurring-bills`, `PATCH|DELETE /recurring-bills/{id}`, `GET /bill-instances` (`status`, `date_from`, `date_to`), `POST /bill-instances/{id}/pay` `{transaction_id?}`.
- **debts**: `GET|POST /debts`, `GET|PATCH|DELETE /debts/{id}`.
- **goals**: `GET|POST /goals`, `GET|PATCH|DELETE /goals/{id}` (resposta inclui `progress`: `current_cents`, `target_cents`, `percent`, `level` para metas com níveis), `POST /goals/{id}/entries`.
- **ingest (chat)**: `POST /ingest` (`multipart/form-data`: `text?`, `file?` até 10 MB) → `IngestResult {extraction_id, document_type, warnings[], drafts: Draft[]}`; `GET /ingest/{extraction_id}`; `Draft {id, status, payload: ProposedTransaction, confidence, low_confidence_fields[], duplicate_of_transaction_id?, plan_rule_warning?, suggested_bill_instance_id?}`; `POST /drafts/{id}/confirm` (corpo opcional com `ProposedTransaction` editado) → `Transaction`; `POST /drafts/{id}/discard`; `POST /drafts/confirm-batch` `{draft_ids[]}`; `GET /attachments/{id}` (binário). Erro `503` com `{"detail", "code": "ai_limit_reached" | "ai_unavailable"}` quando a IA não estiver disponível.
- **push**: `GET /push/vapid-public-key` , `GET|POST /push/subscriptions`, `DELETE /push/subscriptions/{id}`.
- **plan**: `GET|PUT /plan/assumptions`, `GET /plan/projection?scenario=amortize_now|no_amortization` → meses `[{month, income_cents, expense_cents, amortization_cents, debt_balance_cents, reserve_cents}]`, `payoff_month`, `total_interest_cents`.
- **admin** (todas 403 para member): `GET /admin/users`, `POST /admin/users/{id}/reset-pin` `{new_pin}`, `DELETE /admin/users/{id}/sessions`, `GET|PUT /admin/settings`, `POST /admin/notifications/test` `{user_id}`, `GET /admin/push-subscriptions`, `GET /admin/ai/calls`, `GET /admin/audit` (filtros `entity`, `user_id`, paginação), `GET /admin/system` (saúde de banco/agendador, último backup), `GET /admin/backups/latest` (download).
Teste `apps/api/tests/test_openapi_contract.py`: valida o YAML com `openapi-spec-validator` e confere que todos os caminhos acima existem.
**Check:** o teste passa.

## Passo 5 — Infra
- `infra/docker-compose.yml`: serviços `db` (`postgres:16-alpine`, volume `pgdata`, healthcheck `pg_isready`), `api` (build `apps/api/Dockerfile` com contexto na raiz para copiar `apps/web/dist`; build multi-stage: estágio `node:22-alpine` gera o `dist` do web, estágio Python copia), `env_file: ../.env`, depende de `db` saudável, porta `8000:8000`, volumes `uploads:/data/uploads`, `backups:/data/backups`. Volumes nomeados: `pgdata`, `uploads`, `backups`. Fuso `TZ=America/Sao_Paulo`.
- `infra/docker-compose.vps.yml`: override com serviço `caddy` (`caddy:2-alpine`, portas 80/443, `Caddyfile` com placeholder `{$DOMAIN}` → `reverse_proxy api:8000`) e `api` sem porta publicada.
- `infra/scripts/gen-vapid.py`: gera par VAPID (usa `py_vapid`/`cryptography` já trazidos por `pywebpush`) e **imprime** as linhas `VAPID_PUBLIC_KEY=...`/`VAPID_PRIVATE_KEY=...` para o usuário colar no `.env`. Não grava arquivo.
- `infra/scripts/backup.sh` e `restore.sh`: esqueletos com `pg_dump`/`pg_restore` via `docker compose exec db`, retenção de 14 dias no backup. (U13 completa.)
**Check:** `docker compose -f infra/docker-compose.yml config` **se o Docker existir**; senão, valide o YAML com Python (`yaml.safe_load`) e registre "docker indisponível" no handoff.

## Passo 6 — `tasks.ps1` (raiz)
PowerShell com `param([string]$Task = "check")` e tarefas:
- `check`: em `apps/api`: `uv run ruff check .`, `uv run ruff format --check .`, `uv run pytest`; em `apps/web`: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. Para na primeira falha com código de saída ≠ 0 e diz qual etapa falhou.
- `e2e`: placeholder que imprime "definido em U11" e sai 0.
- `ai-live`: `uv run pytest -m live` em `apps/api`.
- `size`: após o build, soma o gzip dos JS/CSS referenciados por `dist/index.html` e falha se > 200 kB.
- `up` / `down`: `docker compose -f infra/docker-compose.yml --env-file .env up -d --build` / `down`.
- `vapid`: roda `infra/scripts/gen-vapid.py` com `uv run` dentro de `apps/api`.
**Check:** `powershell -ExecutionPolicy Bypass -File ./tasks.ps1 check` termina com código 0.

## Fora do escopo de U0
Seed da seção 11 (U4), login real (U1), CRUDs (U2/U4), IA (U5), telas (U3+), notificações (U7), docs de deploy (U13).

## Handoff esperado
Arquivos criados, saída resumida de `./tasks.ps1 check` e `./tasks.ps1 size`, o que não pôde ser verificado (Docker) e qualquer desvio deste plano com o motivo.
