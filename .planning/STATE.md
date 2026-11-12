# Estado vivo — Finanças

> Mantido pelo lead. Workers leem; não editam (exceto quando o brief mandar).

## Fase atual
Onda 0 — Fundação (U0) **integrada no checkout principal**; commitada com ok do Matheus (D19).
Próxima: Onda 1 (U1–U4, `parallel-worktrees`).

## Ambiente (12/11/2026)
- Windows 11, Python 3.14 do sistema + `uv` (o projeto fixa Python 3.12 via `uv`), Node 24 / npm 11, git 2.56.
- Docker 29.9 e Tailscale 1.104 instalados. Máquina na tailnet: `optimousprime`.
- **Sem `make`** → comandos ficam em `tasks.ps1` (seção 10 do ORQUESTRACAO.md permite).
- `.env` local criado pelo lead a partir do `.env.example` (senha do Postgres aleatória; fora do git). OpenAI, VAPID e PINs ainda vazios.

## Gate da Onda 0 (12/11/2026)
- [x] `./tasks.ps1 check` verde (ruff, ruff format, pytest 26, eslint, tsc, vitest 2, vite build).
- [x] `./tasks.ps1 size`: 67 kB gzip (limite 200 kB).
- [x] Migração em Postgres 16 real: `upgrade head`, `downgrade base`, `upgrade head` e `alembic check` sem diferenças.
- [x] `./tasks.ps1 up`: db saudável, api aplica `0001_initial` e sobe; `/api/health` = 200; `/` e `/manifest.webmanifest` = 200.
- [x] `tailscale serve --bg 8000` ativo (tailnet only): `https://optimousprime.tail6cabb8.ts.net/api/health` = 200 via HTTPS.
- [x] PWA aberto e instalado no iPhone 11 via Tailscale (checagem manual do Matheus, 12/11/2026).
- [ ] Galaxy A13: falta instalar o Tailscale e abrir o PWA (não bloqueia a Onda 1).

## Decisões de construção
| Data | Decisão |
|---|---|
| 12/11/2026 | Modelos SQLAlchemy de **todas** as tabelas da seção 7 ficam em `apps/api/src/finance_api/db/models.py` (dono: U0, congelado). Ondas seguintes não alteram tabelas sem passar pelo lead (nova migração). |
| 12/11/2026 | Interface de permissão e usuário atual em `apps/api/src/finance_api/core/` (`deps.py`, `permissions.py`); U1 implementa por trás dela, U2/U4 só importam. |
| 12/11/2026 | Contrato OpenAPI escrito à mão (design-first) em `docs/api/openapi.yaml`, prefixo `/api`; **congelado**. Mudança depois disso = pedido ao lead. |
| 12/11/2026 | Comandos de verificação em `tasks.ps1` (`check`, `e2e`, `ai-live`, `size`, `up`, `down`, `vapid`). |
| 12/11/2026 | API publicada só em `127.0.0.1:8000` no compose; o acesso externo é pelo `tailscale serve` (nunca porta aberta na LAN). |
| 12/11/2026 | `docker compose` à mão precisa de `--env-file .env` (o `tasks.ps1` já passa). Override VPS usa `!reset` (Compose ≥ 2.24). |
| 12/11/2026 | Versões do front: vite 8, TypeScript 6, vitest 5, vite-plugin-pwa 2, eslint 10. Aviso `inlineDynamicImports` obsoleto no build do SW (inofensivo). |
| 12/11/2026 | Workers da alethe rodam com `--setting-sources user`: só valem as permissões de `~/.claude/settings.json` (hoje: `uv` e `tasks.ps1`). `npm` direto ainda pede permissão. |

## Pendências abertas
- Galaxy A13: app Tailscale + abrir o PWA (iPhone já ok).
- U7: confirmar que o `sw.js` gerado (clássico) aceita o handler de push.
- `usage --refresh-agy` falhou (erro de arquivo temporário preso no Windows); sem leitura de cota do agy.
