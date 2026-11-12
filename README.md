# Finanças

App pessoal de finanças do casal (PWA React/TypeScript + FastAPI + PostgreSQL). Lançamentos por chat
com IA (sempre com confirmação), saldos, contas a pagar, metas e projeção do plano financeiro.

## Verificação

```powershell
powershell -ExecutionPolicy Bypass -File ./tasks.ps1 check   # lint, formato, testes e build (api + web)
powershell -ExecutionPolicy Bypass -File ./tasks.ps1 size    # bundle inicial <= 200 kB gzip
```

Outras tarefas: `e2e`, `ai-live`, `up`, `down`, `vapid` (veja `tasks.ps1`).

## Configuração

Copie `.env.example` para `.env` e preencha. Nunca versione o `.env`.

## Documentação

Plano mestre, decisões e unidades: [ORQUESTRACAO.md](ORQUESTRACAO.md). Contrato da API: `docs/api/openapi.yaml`.
