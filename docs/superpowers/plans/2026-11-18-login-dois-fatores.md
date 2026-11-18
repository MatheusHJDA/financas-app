# Login em duas etapas (PIN + chave de acesso) — plano de execução

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entrar no app exige nome digitado + PIN + chave de acesso do aparelho (quando `REQUIRE_PASSKEY=true`), com
códigos de liberação/emergência, sessão curta e limite de tentativas por origem e por conta.

**Architecture:** A API ganha um fluxo em dois pedidos (`/auth/login/start` devolve sempre um desafio WebAuthn e guarda
o resultado do PIN numa tentativa pendente; `/auth/login/finish` dá o único veredito). Chaves, tentativas, códigos e
falhas ficam em tabelas novas (migração 0003). Com a chave desligada (PC/Tailscale) continua existindo
`POST /auth/login` só com PIN, agora com nome digitado e limite por origem. O web pergunta `GET /auth/config` e escolhe
o fluxo.

**Tech Stack:** FastAPI + SQLAlchemy 2 + Alembic + Postgres 16; `webauthn` (py_webauthn 2.x, traz `cbor2` e
`cryptography`); React 18 + React Query + `@simplewebauthn/browser` 13.x; Playwright (autenticador virtual via CDP).

**Spec:** `docs/superpowers/specs/2026-11-17-login-dois-fatores-design.md`

## Global Constraints

- Branch `login-dois-fatores` saído do `master` (já criado). Commits pequenos, mensagens em pt-BR no estilo do repo.
- Mensagem única de falha de login: **"Não foi possível entrar. Confira o nome e o PIN."** (HTTP 401) — para nome
  errado, PIN errado, chave errada/de outra pessoa, código inválido, conta travada e tentativa expirada.
- Origem bloqueada: HTTP 429, `Retry-After`, texto "Muitas tentativas. Aguarde alguns minutos e tente de novo."
- Nome: `strip()` + comparação sem diferenciar maiúsc./minúsc., letras exatas (`" MATHEUS "` vale, `"Mateus"` não).
- Tentativa pendente: 2 min, uso único, só o hash do identificador no banco.
- Sessão com `REQUIRE_PASSKEY=true`: 30 min sem atividade, 12 h no máximo, só sessões `two_factor=true` valem.
  Com `false`: 30 dias renováveis como hoje (`session_days`).
- Web: voltar após **5 min** fora (`visibilitychange`) pede login de novo — só quando a chave é exigida.
- Limites: origem **5 falhas / 15 min**; conta **20 falhas / 1 h** → conta travada **sem prazo**
  (`users.locked_at`), só sai pela Administração (`POST /admin/users/{id}/unlock`) ou, se o travado for o próprio
  admin, pelo comando no servidor `python -m finance_api.auth.release Matheus --desbloquear` (anti-meta: Matheus
  nunca fica sem caminho de volta). `users.locked_until` deixa de ser usado (a migração o zera).
- Código de liberação: 10 caracteres de `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, exibido `XXXXX-XXXXX`, aceito com/sem hífen,
  espaços e minúsculas; 24 h; uso único; só `sha256` no banco. Códigos de emergência: mesmo formato, 8 unidades, sem
  validade, gerados ao cadastrar a **primeira** chave de um **admin**, mostrados uma vez.
- Config: `REQUIRE_PASSKEY` (padrão `false`), `PASSKEY_RP_ID`, `PASSKEY_ORIGIN`. Nada de serviço externo novo.
- Cookie continua `HttpOnly`, `Secure`, `SameSite=Strict`; só hash do token. Auditoria nunca guarda PIN, código,
  token, desafio nem chave pública.
- UI: pt-BR, alvos ≥ 48px, ok em 360px, temas claro/escuro, componentes de `src/ui`.
- Verificação final de cada tarefa: `./tasks.ps1 check` verde (Docker Desktop ligado). Fim do plano: também
  `./tasks.ps1 e2e`.

## Review Focus

1. **Lado do servidor revelando o veredito cedo** — `start` com nome inexistente, PIN errado ou conta travada tem de
   devolver o mesmo formato (mesmas chaves, `allowCredentials` vazio, `user.id` de 16 bytes) e tempo parecido
   (argon2 falso). Teste em Task 4.
2. **Chave válida de outra pessoa** — Ruth digita o nome/PIN dela e usa a chave do Matheus (aparelho compartilhado):
   deve falhar com 401 genérico. Teste em Task 4.
3. **Reenvio da mesma tentativa / tentativa vencida** — `finish` duas vezes com o mesmo `attempt_id`, ou depois de
   2 min: 401 sem abrir sessão. Teste em Task 4.
4. **Sessão PIN-só restaurada do PC** chegando à VPS com `REQUIRE_PASSKEY=true`: deve dar 401 em `/auth/me`.
   Teste em Task 4.
5. **Admin remove a última chave de si mesmo** — continua podendo entrar só com código de emergência/CLI; nada trava
   para sempre. Teste em Task 5 (remover a última chave é permitido e o código de emergência ainda cadastra outra).

---

## Arquivos

API (`apps/api`):
- `pyproject.toml`, `uv.lock` — `webauthn`.
- `src/finance_api/core/config.py` — `require_passkey`, `passkey_rp_id`, `passkey_origin`.
- `alembic/versions/0003_login_dois_fatores.py`, `src/finance_api/db/models.py` — tabelas novas.
- `src/finance_api/auth/limits.py` — origem do pedido, falhas, bloqueios (novo).
- `src/finance_api/auth/codes.py` — códigos de liberação/emergência (novo).
- `src/finance_api/auth/release.py` — comando `python -m finance_api.auth.release <Nome>` (novo).
- `src/finance_api/auth/passkeys.py` — opções/verificação WebAuthn, tentativa pendente, veredito (novo).
- `src/finance_api/auth/service.py`, `auth/router.py` — login por nome, sessões curtas, rotas novas.
- `src/finance_api/admin/router.py` — código de liberação, chaves por usuário, desbloquear.
- `tests/auth/soft_authenticator.py` — autenticador de software para os testes (novo).
- `tests/auth/test_limits.py`, `test_codes.py`, `test_passkeys.py`, `test_auth.py`; `tests/admin/*`;
  `tests/e2e/conftest.py`, `e2e_support.py`, `test_e2e_passkey.py` (novo); `tests/test_openapi_contract.py`.
- `Dockerfile` — `--proxy-headers`.

Contrato: `docs/api/openapi.yaml` (fonte de `apps/web/src/api/schema.d.ts` via `npm run gen:api`).

Web (`apps/web/src`):
- `auth/LoginPage.tsx`, `auth/login.css`, `auth/passkeyLogin.ts` (novo), `auth/RecoveryCodes.tsx` (novo),
  `auth/RequireAuth.tsx`, `auth/useAwayLogout.ts` (novo), `auth/AuthProvider.tsx`, `api/client.ts`.
- `features/settings/DevicesCard.tsx` (novo), `features/settings/PreferencesPage.tsx`.
- `features/admin/UsersSection.tsx`, `features/admin/adminApi.ts`.
- Testes: `auth/__tests__/login.test.tsx`, `App.test.tsx`, `features/settings/__tests__/settings.test.tsx`,
  `features/admin/AdminPage.test.tsx`.

Infra/docs: `infra/docker-compose.yml`, `infra/docker-compose.vps.yml`, `.env.example`, `docs/deploy-vps.md`,
`docs/instalar-no-celular.md`, `.planning/STATE.md`.

---

### Task 1: Dependências, configuração e tabelas

**Files:**
- Modify: `apps/api/pyproject.toml`, `apps/api/uv.lock`, `apps/web/package.json`, `apps/web/package-lock.json`
- Modify: `apps/api/src/finance_api/core/config.py`, `apps/api/src/finance_api/db/models.py`, `.env.example`
- Create: `apps/api/alembic/versions/0003_login_dois_fatores.py`
- Test: `apps/api/tests/test_models.py`

**Interfaces:**
- Produces (Settings): `require_passkey: bool = False`, `passkey_rp_id: str = ""`, `passkey_origin: str = ""`,
  `session_idle_minutes: int = 30`, `session_max_hours: int = 12`.
- Produces (models, `db/models.py`):
  - `User.locked_at: datetime | None` (trava sem prazo; migração zera `locked_until`).
  - `User.webauthn_user_id: bytes | None` (`LargeBinary`, 16 bytes, preenchido na 1ª vez que alguém se cadastra).
  - `UserSession.two_factor: bool` (server_default false), `UserSession.max_expires_at: datetime | None`.
  - `Passkey` (`passkeys`): `id`, `user_id` FK users CASCADE, `credential_id: bytes` único, `public_key: bytes`,
    `sign_count: int`, `device_label: str(120)`, `created_at`, `last_used_at: datetime | None`; índice em `user_id`.
  - `LoginAttempt` (`login_attempts`): `id`, `token_hash: str(64)` único, `purpose` (enum `login_purpose`:
    `login`/`register`), `user_id: int | None` FK CASCADE, `pin_ok: bool`, `challenge: bytes`,
    `code_hash: str(64) | None`, `device_label: str(120)`, `source: str(64)`, `expires_at`, `used_at | None`,
    `created_at`.
  - `AccessCode` (`access_codes`): `id`, `user_id` FK CASCADE, `kind` (enum `access_code_kind`: `release`/`recovery`),
    `code_hash: str(64)`, `expires_at | None`, `used_at | None`, `created_by: int | None` FK users SET NULL,
    `created_at`; índice em `(user_id, code_hash)`.
  - `AuthFailure` (`auth_failures`): `id`, `source: str(64)`, `user_id: int | None` FK CASCADE, `at`; índices em
    `(source, at)` e `(user_id, at)`.

- [ ] **Step 1:** `cd apps/api; uv add webauthn` e `cd apps/web; npm install @simplewebauthn/browser@^13`.
- [ ] **Step 2: teste que falha** em `tests/test_models.py`: `test_passkey_tables_roundtrip` — cria User, `Passkey`
  (credential_id `b"\x01"*16`), `AccessCode(kind="release")`, `LoginAttempt(purpose="login", pin_ok=False, ...)`,
  `AuthFailure(source="1.2.3.4")`, `UserSession(two_factor=True, max_expires_at=...)`, `flush()`, relê e confere os
  campos; e `Passkey` duplicado no mesmo `credential_id` → `IntegrityError`.
- [ ] **Step 3:** `uv run pytest tests/test_models.py -k passkey -v` → FAIL (import).
- [ ] **Step 4:** modelos + migração `0003_login_dois_fatores` (revises `0002_debt_installments`; cria os 2 enums,
  4 tabelas, colunas novas; `downgrade` remove tudo). Settings novos e as três variáveis em `.env.example` com
  comentário ("ligue só na VPS; RP_ID = DOMAIN; ORIGIN = https://DOMAIN").
- [ ] **Step 5:** `uv run pytest tests/test_models.py tests/test_migration_offline.py -v` → PASS.
- [ ] **Step 6:** commit `feat(auth): tabelas e config do login em duas etapas`.

### Task 2: Nome digitado, limite por origem e trava por conta (modo só PIN)

**Files:**
- Create: `apps/api/src/finance_api/auth/limits.py`, `apps/api/tests/auth/test_limits.py`
- Modify: `auth/service.py`, `auth/router.py`, `apps/api/Dockerfile`, `infra/docker-compose.vps.yml`,
  `docs/api/openapi.yaml`, `tests/test_openapi_contract.py`, `tests/auth/conftest.py`, `tests/auth/test_auth.py`,
  `tests/admin/conftest.py`, `tests/admin/test_admin_api.py`, `tests/e2e/conftest.py`
- Modify (web): `src/api/schema.d.ts` (gerado), `src/api/client.ts`, `src/auth/LoginPage.tsx`, `src/auth/login.css`,
  `src/auth/__tests__/login.test.tsx`, `src/App.test.tsx`

**Interfaces:**
- Produces (`auth/limits.py`):
  - `SOURCE_MAX_FAILURES = 5`, `SOURCE_WINDOW = timedelta(minutes=15)`, `ACCOUNT_MAX_FAILURES = 20`,
    `ACCOUNT_WINDOW = timedelta(hours=1)`.
  - `request_source(request: Request) -> str` — `request.client.host` (truncado a 64; `"desconhecida"` se ausente).
  - `source_retry_after(db, source: str, now) -> int | None` — segundos até sair do bloqueio, ou `None`.
  - `record_failure(db, *, source: str, user: User | None, now) -> None` — grava `AuthFailure`; se a conta chega a
    20 na janela, `user.locked_at = now` e grava auditoria `entity="users", action="update",
    after={"locked": True}`. Atualiza `user.failed_attempts` com a contagem da janela (o admin já exibe). Sem commit.
  - `is_locked(user) -> bool` (`locked_at is not None`).
- Produces (`auth/service.py`): `find_user_by_name(db, name: str) -> User | None` (strip + `func.lower`, só nomes de
  `OWNER_BY_USER_NAME`); `login(db, *, name, pin, device_label, source, settings) -> LoginResult` levanta
  `InvalidCredentials` ou `SourceBlocked(retry_after_seconds)`. `AccountLocked` deixa de existir (vira
  `InvalidCredentials`); `MAX_FAILED_ATTEMPTS`/`LOCK_MINUTES` saem.
- Produces (HTTP): `POST /auth/login` body `{name: str(1..80), pin, device_label}`; `GET /auth/config` público →
  `{passkey_required: bool}`; `GET /auth/users` **removido**. Contrato: `PUBLIC` passa a ter `/auth/config` e
  `/auth/login`, sem `/auth/users`.

- [ ] **Step 1: testes que falham** (`tests/auth/test_limits.py`, `tests/auth/test_auth.py`, usando `clock`):
  - `test_login_aceita_nome_com_espacos_e_maiusculas` — `{"name": " MATHEUS ", "pin": PIN_MATHEUS}` → 200.
  - `test_login_nome_parecido_falha_generico` — `"Mateus"` → 401, `detail == "Não foi possível entrar. Confira o nome e o PIN."`;
    PIN errado com nome certo → exatamente o mesmo corpo.
  - `test_users_list_removida` — `GET /api/auth/users` → 404.
  - `test_origem_bloqueada_apos_5_falhas` — 5 PINs errados (nomes variados) → 6º pedido, mesmo com PIN certo, 429
    com `Retry-After`; `clock.advance(minutes=15, seconds=1)` → PIN certo entra.
  - `test_estranho_nao_trava_conta_com_5_erros` — 5 erros de uma origem não travam a Ruth: de outra origem
    (`X-Forwarded-For` não vale; use `TestClient(..., client=("10.0.0.2", 50000))`) o PIN certo entra.
  - `test_conta_trava_com_20_erros_em_1h` — 20 erros em 4 origens → PIN certo dá 401 genérico; `locked_at` preenchido e,
    mesmo com `clock.advance(days=30)`, continua 401; auditoria `users` com `{"locked": True}`; após `POST /admin/users/{id}/reset-pin` (que passa a zerar `locked_at` também) entra (o desbloqueio
    dedicado vem na Task 5).
  - `test_auth_config_publico` — `GET /api/auth/config` sem cookie → `{"passkey_required": false}`.
  - Atualize os testes antigos que esperavam 423 e o teste de `/auth/users`.
- [ ] **Step 2:** `uv run pytest tests/auth -v` → FAIL.
- [ ] **Step 3:** implemente `limits.py`, o novo `service.login` (ordem: origem bloqueada → `SourceBlocked` antes de
  qualquer argon2; usuário por nome; `_burn_time` se não achar; travado ou PIN errado → `record_failure` + commit +
  `InvalidCredentials`), rotas e o contrato. Fixtures que entram por API passam a mandar `name` em vez de `user_id`
  (`tests/auth/conftest.py::login`, `tests/admin/conftest.py`, `tests/e2e/conftest.py::_seed` e `login_as`).
  `Dockerfile`: `uvicorn ... --proxy-headers --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}"`;
  `docker-compose.vps.yml` serviço `api`: `FORWARDED_ALLOW_IPS: "*"` (a API ali não publica porta; só o Caddy a vê).
- [ ] **Step 4:** `uv run pytest tests/auth tests/admin tests/test_openapi_contract.py -v` → PASS.
- [ ] **Step 5 (web): testes que falham** em `login.test.tsx`: a tela mostra campo "Seu nome"
  (`autocomplete="username"`, `autocapitalize="words"`) e o PinPad sem lista de usuários; não chama `/auth/users`;
  digitar nome + 6 dígitos faz `POST /auth/login` com `{name, pin, device_label}`; 401 mostra a mensagem genérica e
  limpa o PIN; 429 mostra "Muitas tentativas. Aguarde alguns minutos e tente de novo."; PIN completo sem nome não
  envia e foca o campo de nome.
- [ ] **Step 6:** `npm run gen:api`; reescreva o corpo de `LoginPage` (marca no topo, campo de nome, PinPad);
  `client.ts`: `SILENT_401` inclui `/auth/login`, `/auth/me`, `/auth/login/start`, `/auth/login/finish`.
  `npm test -- login App` → PASS.
- [ ] **Step 7:** `./tasks.ps1 check` verde; commit `feat(auth): nome digitado e limite por origem no login`.

### Task 3: Códigos de liberação e de emergência + comando no servidor

**Files:**
- Create: `apps/api/src/finance_api/auth/codes.py`, `apps/api/src/finance_api/auth/release.py`,
  `apps/api/tests/auth/test_codes.py`
- Modify: `apps/api/src/finance_api/admin/router.py`, `docs/api/openapi.yaml`, `tests/test_openapi_contract.py`,
  `tests/admin/test_admin_api.py`

**Interfaces:**
- Produces (`auth/codes.py`):
  - `ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"`, `RELEASE_TTL = timedelta(hours=24)`, `RECOVERY_COUNT = 8`.
  - `normalize_code(raw: str) -> str` (maiúsculas, sem `-` nem espaços), `format_code(code: str) -> str` (`XXXXX-XXXXX`),
    `hash_code(raw: str) -> str` (`sha256` do normalizado).
  - `issue_release_code(db, user: User, *, actor_id: int | None, now) -> tuple[str, datetime]` — gera, grava, audita
    (`entity="access_codes", action="create", after={"user_id", "kind": "release"}`), devolve código formatado e
    validade. Sem commit.
  - `issue_recovery_codes(db, user, *, now) -> list[str]` — apaga emergência antiga não usada do usuário, grava 8.
  - `consume_code(db, user: User, code_hash: str, now) -> AccessCode | None` — acha código do usuário não usado e não
    vencido (`expires_at` nulo = sem validade), marca `used_at`, audita `action="update", after={"kind", "used": True}`.
- Produces (CLI): `python -m finance_api.auth.release <Nome> [--desbloquear]` — sem a opção, imprime `Código de liberação para <Nome>: XXXXX-XXXXX
  (vale até dd/mm/aaaa hh:mm)` e sai 0; nome desconhecido → mensagem e saída 1. Usa `find_user_by_name` (Task 2).
- Produces (HTTP): `POST /admin/users/{id}/release-code` → 201 `{code: str, expires_at: datetime}`.

- [ ] **Step 1: testes que falham** (`test_codes.py`, com `clock`): formato `^[A-HJ-KM-NP-Z2-9]{5}-[A-HJ-KM-NP-Z2-9]{5}$`;
  `normalize_code(" abcde-fghjk ") == "ABCDEFGHJK"`; código vale uma vez; vencido após 24 h + 1 s; código da Ruth
  não serve para o Matheus; `issue_recovery_codes` devolve 8 distintos e invalida os anteriores; banco só tem hash
  (nenhuma coluna contém o código); CLI (`release.main(["Matheus"])` com `capsys`) imprime o código e grava 1 linha;
  `release.main(["Fulano"])` → 1; `release.main(["Matheus", "--desbloquear"])` zera `locked_at`/falhas, audita e
  imprime "Conta de Matheus desbloqueada." sem gerar código. Admin: Ruth → 403; Matheus gera para Ruth → 201 e auditoria sem o código.
- [ ] **Step 2:** `uv run pytest tests/auth/test_codes.py tests/admin -v` → FAIL.
- [ ] **Step 3:** implemente (`secrets.choice`), rota admin e contrato.
- [ ] **Step 4:** testes → PASS; commit `feat(auth): códigos de liberação e de emergência`.

### Task 4: Fluxo em duas etapas e sessão curta

**Files:**
- Create: `apps/api/src/finance_api/auth/passkeys.py`, `apps/api/tests/auth/soft_authenticator.py`,
  `apps/api/tests/auth/test_passkeys.py`
- Modify: `auth/service.py`, `auth/router.py`, `docs/api/openapi.yaml`, `tests/test_openapi_contract.py`,
  `tests/auth/conftest.py`

**Interfaces:**
- Consumes: `limits.*` (Task 2), `codes.hash_code`, `codes.consume_code`, `codes.issue_recovery_codes` (Task 3),
  `notifications.service.deliver` + `notifications.channels.get_channel`.
- Produces (`tests/auth/soft_authenticator.py`): `SoftAuthenticator(rp_id: str, origin: str)` com chave EC P-256
  (`cryptography`) e atestação `none`; `.register(options: dict) -> dict` e `.authenticate(options: dict) -> dict`
  devolvem o JSON que o navegador mandaria (`id`, `rawId`, `type`, `response{clientDataJSON, attestationObject |
  authenticatorData, signature, userHandle}` em base64url); flags UP+UV ligadas; contador incrementa; guarda o
  `user.id` da opção de cadastro para o `userHandle`. CBOR com `cbor2`.
- Produces (`auth/passkeys.py`):
  - `ATTEMPT_TTL = timedelta(minutes=2)`.
  - `start(db, *, name: str, pin: str, release_code: str | None, device_label: str, source: str, settings) ->
    tuple[str, dict]` — devolve `(attempt_id, options_json)`. Origem bloqueada → `SourceBlocked`. Com código →
    `purpose="register"`, opções de cadastro (`residentKey=required`, `userVerification=required`, `excludeCredentials`
    vazio, `user.id` = `webauthn_user_id` do usuário certo ou 16 bytes aleatórios, `user.name` = o nome digitado);
    sem código → `purpose="login"`, opções de autenticação com `allowCredentials` vazio e UV `required`. PIN errado /
    nome desconhecido / conta travada → `record_failure` e `pin_ok=False`, mas a resposta tem o mesmo formato.
  - `finish(db, *, attempt_id: str, credential: dict, source: str, settings) -> FinishResult` — único veredito.
    Sucesso exige: tentativa existe, não usada, não vencida, `pin_ok`, conta não travada, e
    - login: `verify_authentication_response` com a chave achada por `credential_id`, `passkey.user_id ==
      attempt.user_id`; atualiza `sign_count` e `last_used_at`;
    - cadastro: `verify_registration_response`, `consume_code(attempt.user_id, attempt.code_hash)`; grava `Passkey`
      com `device_label`; se é a 1ª chave de um admin → `issue_recovery_codes`; envia `deliver(..., "new_device",
      {"title": "Aparelho novo liberado", "body": f"Um aparelho novo foi liberado na sua conta: {label}",
      "url": "/preferencias"})` aos aparelhos já inscritos (falha de envio não derruba o login).
    Marca `used_at` sempre. Falha → `record_failure` + `InvalidCredentials`. Sucesso → sessão `two_factor=True`.
    Audita: `entity="passkeys", action="create"` (cadastro, `after={"user_id", "device_label"}`) e
    `entity="sessions", action="create", after={"user_id", "two_factor": True}` (entrada) e, na falha do `finish`,
    `entity="sessions", action="create", after={"user_id": <ou None>, "ok": False, "source"}` (falha relevante).
  - `FinishResult(token: str, user: User, recovery_codes: list[str] | None)`.
- Produces (`auth/service.py`): `open_session(db, user, *, device_label, two_factor: bool, settings) -> tuple[str,
  UserSession]` usado pelos dois caminhos; com `require_passkey`: `expires_at = now + session_idle_minutes`,
  `max_expires_at = now + session_max_hours`; sem: `now + session_days`, `max_expires_at=None`.
  `authenticate_token`: com `require_passkey`, sessão sem `two_factor` → `None`; renova para
  `min(now + idle, max_expires_at)`. `POST /auth/login` (só PIN) com `require_passkey` → 401 genérico.
- Produces (HTTP): `POST /auth/login/start` público `{name, pin, device_label, release_code?: str|null}` → 200
  `{attempt_id: str, mode: "login"|"register", options: object}` (429 se origem bloqueada);
  `POST /auth/login/finish` público `{attempt_id, credential: object}` → 200 `{me: Me, recovery_codes:
  string[]|null}` + cookie (`max_age` = `session_max_hours*3600` com a chave ligada), ou 401 genérico.
  `GET /auth/config` passa a ler `require_passkey`.

- [ ] **Step 1: autenticador de teste** + `test_soft_authenticator_roundtrip` (opções de `webauthn.generate_*` →
  `verify_*` da biblioteca aceita). Rode → PASS (é o alicerce dos próximos testes).
- [ ] **Step 2: testes que falham** em `test_passkeys.py` (fixture `passkey_settings`: `require_passkey=True`,
  `passkey_rp_id="testserver"`, `passkey_origin="https://testserver"`, via `app.dependency_overrides[get_settings]`
  e `monkeypatch` em `config_module.get_settings`, como o e2e faz):
  - `test_cadastro_com_codigo_entra_e_da_codigos_de_emergencia_ao_admin` — código do Matheus + PIN → 200,
    `len(recovery_codes) == 8`, cookie; segunda chave do Matheus → `recovery_codes is None`; Ruth → sempre `None`.
  - `test_login_com_chave_entra` — depois do cadastro, `start` sem código + `authenticate` → 200, `/auth/me` ok.
  - `test_start_nao_revela_veredito` — nome certo/PIN certo, PIN errado, nome inexistente e conta travada: as quatro
    respostas têm as mesmas chaves, `mode == "login"`, `options["allowCredentials"] == []`; com código, os
    `user.id` têm o mesmo tamanho.
  - `test_pin_errado_com_chave_certa_falha` → 401 genérico; conta 1 falha.
  - `test_chave_de_outra_pessoa_falha` (Review Focus 2).
  - `test_tentativa_reusada_ou_vencida_falha` (Review Focus 3) — `clock.advance(minutes=2, seconds=1)`.
  - `test_codigo_usado_nao_cadastra_de_novo`; `test_sem_chave_sem_codigo_nao_entra`.
  - `test_aviso_de_aparelho_novo` — com uma `PushSubscription` do Matheus e canal falso
    (`app.dependency_overrides`/monkeypatch de `get_channel`), cadastrar a 2ª chave envia 1 payload com o texto acima.
  - `test_sessao_pin_so_nao_vale_com_chave_ligada` (Review Focus 4) — sessão criada com `two_factor=False` → 401.
  - `test_sessao_30min_parada_e_12h_maximo` — +29 min ok e renova; +31 min parado → 401; em uso a cada 20 min,
    após 12 h → 401.
  - `test_login_so_pin_desligado_quando_chave_exigida` — `POST /auth/login` → 401.
  - `test_auditoria_sem_segredos` — nenhuma linha de `audit_log` contém PIN, código, `attempt_id`, desafio.
- [ ] **Step 3:** `uv run pytest tests/auth/test_passkeys.py -v` → FAIL.
- [ ] **Step 4:** implemente `passkeys.py` (py_webauthn: `generate_registration_options`,
  `generate_authentication_options`, `options_to_json`, `verify_registration_response`,
  `verify_authentication_response`, `base64url_to_bytes`; `expected_rp_id=settings.passkey_rp_id`,
  `expected_origin=settings.passkey_origin`, `require_user_verification=True`), `open_session` e as rotas; contrato
  com os dois caminhos novos em `EXPECTED` e `PUBLIC`.
- [ ] **Step 5:** `uv run pytest tests/auth -v` → PASS; `./tasks.ps1 check`; commit
  `feat(auth): entrada em duas etapas com chave de acesso`.

### Task 5: Gerenciar chaves e desbloquear conta (API)

**Files:**
- Modify: `auth/router.py`, `admin/router.py`, `docs/api/openapi.yaml`, `tests/test_openapi_contract.py`,
  `tests/auth/test_passkeys.py`, `tests/admin/test_admin_api.py`

**Interfaces:**
- Produces (HTTP):
  - `GET /auth/passkeys` → `PasskeyOut[]` `{id, device_label, created_at, last_used_at}` do usuário logado.
  - `DELETE /auth/passkeys/{id}` → 204; dono ou admin; senão 403; inexistente 404. Audita `entity="passkeys",
    action="delete"`. Remover a última chave é permitido.
  - `GET /admin/users/{id}/passkeys` → `PasskeyOut[]`.
  - `POST /admin/users/{id}/unlock` → 204; zera `locked_at`, `failed_attempts`, apaga `AuthFailure` do usuário;
    audita `after={"unlocked": True}`.
  - `AdminUserOut` ganha `passkey_count: int`.

- [ ] **Step 1: testes que falham:** listar só as próprias; Ruth não remove a do Matheus (403); Matheus remove a da
  Ruth; após remover a única chave do Matheus, um código de emergência ainda cadastra outra (Review Focus 5);
  `unlock` faz o PIN certo voltar a entrar após a trava de 20; Ruth em `/admin/...` → 403; `passkey_count` certo.
- [ ] **Step 2:** rode → FAIL; implemente; rode → PASS; commit `feat(auth): listar e remover chaves, desbloquear conta`.

### Task 6: Web — entrada em duas etapas, volta ao destino e 5 min fora

**Files:**
- Create: `src/auth/passkeyLogin.ts`, `src/auth/RecoveryCodes.tsx`, `src/auth/useAwayLogout.ts`
- Modify: `src/api/schema.d.ts` (gerado), `src/auth/LoginPage.tsx`, `src/auth/login.css`, `src/auth/RequireAuth.tsx`,
  `src/auth/AuthProvider.tsx`, `src/shell/Shell.tsx` (montar o hook), `src/auth/__tests__/login.test.tsx`,
  `src/App.test.tsx`

**Interfaces:**
- Consumes: rotas da Task 4.
- Produces:
  - `fetchAuthConfig(): Promise<{passkey_required: boolean}>` (query `["auth-config"]`, `staleTime: Infinity`).
  - `passkeyLogin({name, pin, releaseCode}): Promise<{me: Me; recoveryCodes: string[] | null}>` — `start` →
    `startAuthentication({optionsJSON})` ou `startRegistration({optionsJSON})` conforme `mode` → `finish`. Erros:
    `LoginError(status)`; cancelamento do Face ID/Hello (`NotAllowedError`) → `LoginError(0, "cancelado")`.
  - `safeNext(raw: string | null): string` — aceita só caminhos que começam com `/` e não com `//`; senão `"/"`.
  - `useAwayLogout(enabled: boolean, limitMs = 5 * 60_000)` — guarda `Date.now()` ao ficar `hidden`; ao voltar a
    `visible` depois do limite chama `logout()` e navega para `/login?next=<rota atual>`.

Textos: botão "Entrar" (habilitado com nome + 6 dígitos, no modo com chave o PIN não envia sozinho); ligação
"Tenho um código de liberação" abre o campo "Código de liberação" (`XXXXX-XXXXX`); passo 2 "Confirme neste aparelho"
com botão "Usar Face ID / digital / Windows Hello" (refaz a etapa se cancelado: "Confirmação cancelada. Toque para
tentar de novo."); `RecoveryCodes`: título "Guarde seus códigos de emergência", texto "Cada código vale uma vez e
serve para liberar um aparelho novo se você perder todos. Eles não aparecem de novo.", lista em fonte monoespaçada,
botão "Copiar" e botão "Já guardei" (só então segue para `next`). Sem chave exigida, a tela é a da Task 2.

- [ ] **Step 1: testes que falham** (mock de `fetch` e de `@simplewebauthn/browser` com `vi.mock`):
  - modo chave: nome + PIN + "Entrar" → `start` com `release_code: null` → `startAuthentication` chamado com
    `options` → `finish` → vai para `/`.
  - com código: `startRegistration` é chamado; `recovery_codes` de 8 → tela de códigos; "Já guardei" segue.
  - 401 em `finish` → mensagem genérica, PIN limpo, volta ao passo 1.
  - cancelado → mensagem de cancelado e botão para tentar de novo, sem novo `start` até tocar.
  - `RequireAuth` sem sessão em `/lancar?meta=4` → `/login?next=%2Flancar%3Fmeta%3D4`; após entrar → `/lancar?meta=4`;
    `safeNext("//mal.com") === "/"`.
  - `useAwayLogout`: com `vi.useFakeTimers`, `hidden` → +5 min 1 s → `visible` chama logout; +4 min não chama;
    `enabled=false` nunca chama.
- [ ] **Step 2:** `npm test -- login App` → FAIL.
- [ ] **Step 3:** `npm run gen:api` e implemente.
- [ ] **Step 4:** `npm test` → PASS; `./tasks.ps1 check`; commit `feat(web): entrada com chave de acesso`.

### Task 7: Web — Preferências → Aparelhos e Administração → Usuários

**Files:**
- Create: `src/features/settings/DevicesCard.tsx`
- Modify: `src/features/settings/PreferencesPage.tsx`, `src/features/settings/settings.css`,
  `src/features/admin/UsersSection.tsx`, `src/features/admin/adminApi.ts`, `src/features/admin/admin.css`,
  `src/features/settings/__tests__/settings.test.tsx`, `src/features/admin/AdminPage.test.tsx`

**Interfaces:**
- Consumes: rotas das Tasks 3 e 5.
- Produces: `adminApi.ts` — `createReleaseCode(userId) -> {code, expires_at}`, `fetchUserPasskeys(userId)`,
  `deletePasskey(id)`, `unlockUser(userId)`.

Telas: `DevicesCard` (título "Aparelhos", ícone `KeyRound`) lista "nome do aparelho · cadastrado em dd/mm/aaaa ·
último uso dd/mm/aaaa hh:mm" (ou "nunca usado") com "Remover" e confirmação ("Remover a chave deste aparelho? Ele vai
precisar de um código de liberação para entrar de novo."); vazio: "Nenhuma chave cadastrada." — o card aparece
sempre (com a chave desligada também). Em Usuários, por pessoa: contagem de chaves, "Gerar código de liberação"
(mostra o código formatado, a validade e "Copiar"), lista das chaves com "Remover", e "Desbloquear" quando
`locked_at` está preenchido (texto "Travada por tentativas erradas — só a administração libera").

- [ ] **Step 1: testes que falham:** card lista e remove (DELETE chamado após confirmar, lista recarrega); vazio;
  admin gera código e o mostra com validade; admin remove chave da Ruth; "Desbloquear" aparece só se travado e chama
  a rota.
- [ ] **Step 2:** `npm test -- settings Admin` → FAIL; implemente; → PASS; `./tasks.ps1 check`; commit
  `feat(web): aparelhos nas preferências e códigos na administração`.

### Task 8: E2E com autenticador virtual, infra e documentação

**Files:**
- Create: `apps/api/tests/e2e/test_e2e_passkey.py`
- Modify: `apps/api/tests/e2e/e2e_support.py` (`Env.settings`), `apps/api/tests/e2e/conftest.py`,
  `apps/api/tests/e2e/test_e2e_flows.py` (teste de login da tela: nome digitado), `docs/deploy-vps.md`,
  `docs/instalar-no-celular.md`, `.planning/STATE.md`

**Interfaces:**
- Consumes: tudo acima.
- Produces: fixture `passkey_mode(e2e_env)` que liga `require_passkey=True`, `passkey_rp_id="localhost"`,
  `passkey_origin=e2e_env.base_url` no objeto `Settings` compartilhado e restaura no `finally`; helper
  `virtual_authenticator(page)` via `context.new_cdp_session(page)`: `WebAuthn.enable` +
  `WebAuthn.addVirtualAuthenticator` `{protocol: "ctap2", transport: "internal", hasResidentKey: true,
  hasUserVerification: true, isUserVerified: true}`.

- [ ] **Step 1: testes e2e** (dispositivos `iphone-11` e `desktop`):
  - `test_primeiro_acesso_com_codigo_cadastra_chave_e_entra` — código gerado por `codes.issue_release_code` direto no
    banco do e2e; tela: nome, PIN, "Tenho um código de liberação", código, Entrar, confirmar → tela dos 8 códigos →
    "Já guardei" → Início; layout sem rolagem horizontal.
  - `test_segundo_acesso_so_com_chave` — mesmo contexto/autenticador, sair, entrar com nome + PIN → Início.
  - `test_pin_errado_mensagem_generica` — mensagem exata do spec.
  - `test_aviso_abre_destino_apos_login` — abrir `/lancar?meta=4` sem sessão → login → cai em `/lancar?meta=4`.
- [ ] **Step 2:** `./tasks.ps1 e2e` → os novos falham antes de ajustes de fixture; ajuste; → tudo verde (os 91
  existentes continuam passando com a chave desligada).
- [ ] **Step 3: docs.** `deploy-vps.md`: variáveis `REQUIRE_PASSKEY=true`, `PASSKEY_RP_ID=$DOMAIN`,
  `PASSKEY_ORIGIN=https://$DOMAIN`, `FORWARDED_ALLOW_IPS`; os 4 passos da virada do spec (incluindo
  `docker compose -f infra/docker-compose.yml -f infra/docker-compose.vps.yml exec api python -m
  finance_api.auth.release Matheus`). `instalar-no-celular.md`: primeiro acesso com código, Face ID/digital/Hello,
  "Mais → Preferências → Aparelhos", o que fazer ao trocar de celular. `STATE.md`: entrada nova no topo.
- [ ] **Step 4:** `./tasks.ps1 check` e `./tasks.ps1 e2e` verdes; commit `test(e2e): login com chave de acesso; docs da virada`.
