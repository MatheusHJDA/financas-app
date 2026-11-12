# Estado vivo — Finanças

> Mantido pelo lead. Workers leem; não editam (exceto quando o brief mandar).

## Fase atual
Onda 0 — Fundação (U0). Playbook `plan-execute`. Plano de passos: `.planning/U0-fundacao.md`.

## Ambiente (12/11/2026)
- Windows 11, Python 3.14 do sistema + `uv` (o projeto fixa Python 3.12 via `uv`), Node 24 / npm 11, git 2.56.
- **Sem `make`** → comandos ficam em `tasks.ps1` (seção 10 do ORQUESTRACAO.md permite).
- **Sem Docker, Postgres e Tailscale instalados** neste momento. Partes do gate de U0 que dependem deles
  (`docker compose up`, migração em banco real, PWA no celular) ficam pendentes até a instalação.
  Enquanto isso: migração verificada em modo offline (`alembic upgrade head --sql`).

## Decisões de construção
| Data | Decisão |
|---|---|
| 12/11/2026 | Modelos SQLAlchemy de **todas** as tabelas da seção 7 ficam em `apps/api/src/finance_api/db/models.py` (dono: U0, congelado). Ondas seguintes não alteram tabelas sem passar pelo lead (nova migração). |
| 12/11/2026 | Interface de permissão e usuário atual em `apps/api/src/finance_api/core/` (`deps.py`, `permissions.py`); U1 implementa por trás dela, U2/U4 só importam. |
| 12/11/2026 | Contrato OpenAPI escrito à mão (design-first) em `docs/api/openapi.yaml`, prefixo `/api`; congelado ao fim da Onda 0. Mudança depois disso = pedido ao lead. |
| 12/11/2026 | Comandos de verificação em `tasks.ps1` (`check`, `e2e`, `ai-live`, `size`). |

## Pendências abertas
- Instalar Docker Desktop e Tailscale (Matheus) para fechar o gate de U0.
- `usage --refresh-agy` falhou (erro de arquivo temporário preso no Windows); sem leitura de cota do agy.
