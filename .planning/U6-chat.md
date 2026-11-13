# U6 — Tela de chat — plano em passos (lead)

> Especificação: ORQUESTRACAO.md 6.2 (fluxo e regras) e U6 (seção 9). Contrato congelado:
> `docs/api/openapi.yaml`; tipos gerados em `apps/web/src/api/schema.d.ts` (cliente `api` em
> `src/api/client.ts`, `openapi-fetch`). Comportamento da API: `.planning/STATE.md`, seção "U5".

## Regra que não pode falhar
**Nada grava lançamento sem um toque em Confirmar** (ou "Confirmar todos" depois de revisar).
Enviar mensagem/arquivo só cria rascunhos. "Marcar conta como paga" é outro toque explícito,
depois da confirmação; nunca automático.

## Posse
- Escreve: `apps/web/src/features/chat/**` (componentes, hooks, estilos `.css` do módulo, testes).
- Já feito pelo lead: `features/chat/ChatPage.tsx` (placeholder) montado pela aba inicial
  (`shell/tabs/ChatTab.tsx` reexporta). Mantenha o `default export` de `ChatPage`.
- Só usa (não edita): `src/api/*`, `src/ui/States.tsx`, `src/styles/tokens.css`, `src/auth/*`
  (`useAuth` para saber quem está logado). Não edite `shell/`, `app/`, `auth/`, `api/`, `styles/`,
  `package.json`, `vite.config.ts`. Precisa de algo fora disso → pare e reporte.

## Passos (cada um com a checagem que o prova)

1. **Dados de apoio** (`useChatData`): contas ativas (`GET /accounts`), categorias
   (`GET /categories`), com React Query. *Check*: teste com fetch simulado.

2. **Envio** (`sendIngest`): `POST /ingest` multipart com `text` e/ou `file`. Use `XMLHttpRequest`
   para ter **progresso de upload** (fetch não dá); `credentials` incluídos; 401 → mesmo fluxo do
   cliente (`onUnauthorized`). Antes de enviar: arquivo > 10 MB → erro local, sem enviar; tipos
   aceitos `image/*` e `application/pdf`. Erros: 413/422 → mensagem do `detail`; 503 com
   `code: ai_limit_reached` → "O limite mensal da IA foi atingido. Lance pelo formulário." e abre o
   formulário manual; `ai_unavailable` → mensagem amigável + formulário manual.
   *Check*: testes do envio (progresso, 10 MB local, 503 limite abre formulário).

3. **Caixa de mensagem**: texto (Enter envia, Shift+Enter quebra linha), botões **Câmera**
   (`<input type="file" accept="image/*" capture="environment">`), **Galeria** (`accept="image/*"`),
   **PDF** (`accept="application/pdf"`); prévia do anexo com remover; botão Enviar desabilitado
   durante o envio; barra de progresso. Histórico da conversa na sessão da tela (mensagens do
   usuário + respostas com cartões); não precisa persistir.
   *Check*: testes de interação (texto, imagem, PDF).

4. **Cartões de proposta** (um por rascunho do `IngestResult`): valor (R$ a partir de centavos,
   sem float para cálculo — formate com `Intl.NumberFormat` a partir de `cents/100` só na exibição),
   data (dd/mm/aaaa), tipo, conta, conta destino (transferência), categoria, dono, descrição,
   confiança. Campos em `low_confidence_fields` destacados (cor + texto, não só cor). Sinais:
   `duplicate_of_transaction_id` → "Já existe?" ; `plan_rule_warning` → aviso; avisos do
   `IngestResult.warnings` acima dos cartões; `suggested_bill_instance_id` → guardado para o passo 6.
   *Check*: teste de renderização com fixture de `IngestResult` (2+ rascunhos, baixa confiança,
   duplicata, regra do plano).

5. **Ações**: **Confirmar** (`POST /drafts/{id}/confirm`; se editado, manda a proposta editada),
   **Editar** (formulário no próprio cartão: tipo, valor em R$ → centavos inteiros sem float
   — parse de string "1.234,56" → 123456 —, data, conta, destino, categoria, dono, descrição;
   conta obrigatória), **Descartar** (`POST /drafts/{id}/discard`), **Confirmar todos**
   (`POST /drafts/confirm-batch` com os pendentes; só aparece com 2+ pendentes e pede uma
   confirmação "Confirmar N lançamentos?"). Botões desabilitados durante a chamada (sem duplo
   envio). Estados finais no cartão: Confirmado / Descartado. Erros: 403 → "Você não pode lançar
   nessa conta."; 409 → atualizar o cartão (já resolvido); 422 → mensagem do `detail`.
   Depois de confirmar, invalidar queries de lançamentos/visão geral (`["transactions"]`,
   `["overview"]`, `["accounts"]`).
   *Check*: testes: nada é chamado em `/drafts/*` sem clique; editar antes de confirmar manda a
   proposta editada; duplo clique gera 1 chamada; lote; descartar.

6. **Conta a pagar sugerida**: confirmado um cartão com `suggested_bill_instance_id`, mostrar
   "Marcar como paga?" → `POST /bill-instances/{id}/pay` com `{transaction_id}` do lançamento
   criado. Só com toque.
   *Check*: teste.

7. **Formulário manual** (sem IA): mesmos campos do Editar → `POST /transactions`
   (`source` é do servidor). Abre por botão "Lançar à mão" e nos erros de IA.
   *Check*: teste do envio manual e do valor em centavos.

8. **Acessibilidade e celular**: alvos ≥ 44 px, rótulos em todos os campos e botões, foco visível,
   `aria-live` para progresso e resultados, nada de largura fixa (cabe em 360–412 px), respeita a
   área segura de baixo (a barra de abas já existe). Tokens de `styles/tokens.css`.

## Testes
vitest + testing-library com `fetch`/`XMLHttpRequest` simulados (fixtures de `IngestResult` em
`features/chat/__fixtures__/`). Cobrir texto, imagem e PDF de ponta a ponta na tela (enviar →
cartões → editar → confirmar). O E2E com Playwright fica para a U11 (não instale Playwright).

## Pronto quando
`./tasks.ps1 check` verde; `./tasks.ps1 size` ≤ 200 kB gzip (a tela é carregada sob demanda);
testes cobrem texto, imagem e PDF; editar antes de confirmar funciona; nada grava sem toque em
Confirmar (teste prova que nenhuma chamada a `/drafts/*` ou `/transactions` acontece sem clique).
