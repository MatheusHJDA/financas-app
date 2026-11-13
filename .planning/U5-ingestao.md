# U5 — Ingestão por IA (API) [risco] — plano em passos (lead)

> Especificação: ORQUESTRACAO.md 6.2 e U5 (seção 9). Contrato congelado: `docs/api/openapi.yaml`
> (`/ingest`, `/ingest/{extraction_id}`, `/drafts/{id}/confirm`, `/drafts/{id}/discard`,
> `/drafts/confirm-batch`, `/attachments/{id}`; schemas `IngestResult`, `Draft`,
> `ProposedTransaction`, `AiError`). Tabelas congeladas em `db/models.py`: `attachments`,
> `ai_extractions`, `drafts`, `transactions`.

## Regra que não pode falhar
**Nenhum caminho de `/ingest` grava lançamento.** Só `confirm`/`confirm-batch` criam, e só a partir
de rascunho `pending`, com permissão do usuário (mesmas regras do U2).

## Posse
- Escreve: `apps/api/src/finance_api/{ai,ingest,attachments}/**`, `apps/api/tests/{ai,ingest,attachments}/**`,
  `apps/api/tests/fixtures/ai/**`.
- Só importa (não edita): `core/*`, `db/models.py`, `transactions/service.py`
  (`TxData`, `create_transaction`, `plan_rule_warning`), `transactions/dedupe.py`
  (`find_possible_duplicates`, `normalize_description`), `accounts`, `categories`.
- Já feito pelo lead: `ingest/router.py` (vazio) ligado em `main.py`; `Settings` com
  `openai_api_key`, `openai_model`, `openai_timeout_seconds`, `upload_dir`, `max_upload_bytes`.
- Não muda: contrato, migrações, `main.py`, `conftest.py` raiz, `pyproject.toml` (dependências já
  estão: `openai`, `pypdf`, `pillow`, `pillow-heif`, `python-multipart`). Precisa de algo fora
  disso → pare e reporte.

## Passos (cada um com a checagem que o prova)

1. **`ai/schemas.py` — `ExtractionResult`** (Pydantic, `extra="forbid"`): exatamente o JSON da 6.2
   (`transactions[]` com `kind`, `amount_cents` int > 0, `date`, `description`, `account_hint`,
   `to_account_hint`, `category_hint`, `owner_hint`, `is_credit_card`, `confidence` 0–1, `notes`;
   `document_type` ∈ receipt|statement|invoice|free_text|other; `warnings[]`). `PROMPT_VERSION`.
   *Check*: testes de validação (float em `amount_cents` → erro; campo extra → erro).

2. **`ai/context.py` — contexto mínimo**: data de hoje (`America/Sao_Paulo`), nome de quem enviou,
   contas ativas (nome, tipo, dono, `last4`), categorias (nome, tipo), regras de classificação
   (6.2: transferência interna, cartão, centavos). Nada mais.
   *Check*: teste que serializa o contexto e prova que não contém `pin_hash`, `token_hash`, saldo,
   e-mail nem dados de sessão.

3. **`ai/client.py` — cliente trocável**:
   - `class AiClient(Protocol)`: `extract(*, context, text: str | None, images: list[bytes]) -> AiCall`
     (`AiCall`: `result: ExtractionResult`, `raw: dict`, `model`, `usage_tokens`).
   - `OpenAIClient`: SDK `openai`, saída estruturada com o schema (Responses API `parse`), modelo
     **só** de `settings.openai_model`; chave ou modelo vazios → `AiUnavailable`.
   - Erros: 429 com código `project_spend_limit_exceeded`/`organization_spend_limit_exceeded` →
     `AiLimitReached` **sem repetir**; outro 429/5xx/timeout → até 2 novas tentativas com espera
     crescente (função `sleep` injetável); saída que não valida → 1 nova tentativa, depois
     `AiInvalidOutput`.
   - Dependência FastAPI `get_ai_client` (override nos testes por `FakeAiClient` que lê fixtures).
   *Check*: testes com SDK simulado (sem rede): limite não repete (1 chamada), 5xx repete 2× e
   desiste, saída inválida repete 1×, chave vazia → 503 `ai_unavailable`.

4. **`attachments/` — arquivo enviado**:
   - Tamanho > `max_upload_bytes` → 413 (sem gravar nada). Tipo pelo conteúdo (magic bytes), não
     pelo nome: JPEG, PNG, WEBP, HEIC/HEIF, PDF; outro → 422.
   - Grava em `upload_dir/AAAA/MM/<sha256>.<ext>` (nome nunca vem do cliente) + linha `attachments`.
   - Preparo para a IA: HEIC → JPEG (`pillow-heif`); imagem reduzida (lado maior ≤ 2000 px, JPEG);
     PDF digital → texto (`pypdf`); PDF escaneado (pouco texto) → imagens das páginas (`page.images`,
     até 5 páginas).
   - `GET /attachments/{id}`: qualquer usuário logado; 404 se não existe; o caminho do disco tem de
     ficar dentro de `upload_dir`.
   *Check*: testes com arquivos gerados no teste (Pillow cria JPEG/PNG; `Image.save(..., "PDF")`
   cria PDF escaneado; PDF digital mínimo em `tests/fixtures/ai/`), `upload_dir` em `tmp_path`.

5. **`ingest/resolve.py` — dicas → ids**: conta por nome/`last4` (sem acento, sem caixa), categoria
   por nome, dono pela dica ou pelo de quem enviou. Transferência só se origem **e** destino forem
   contas do app; senão vira despesa/receita com aviso. `low_confidence_fields`: campos sem id
   resolvido e, se `confidence < 0.7`, todos os campos que a IA chutou.
   Para cada rascunho: `duplicate_of_transaction_id` (`find_possible_duplicates`),
   `plan_rule_warning` (`transactions.service.plan_rule_warning`), `suggested_bill_instance_id`
   (conta a pagar `open` com valor ±5%, vencimento a ±20 dias e nome parecido).
   *Check*: testes puros com contas "Sonia" e "Matheus" → `transfer`; cartão → aviso de regra do plano.

6. **`ingest/service.py` + router — `POST /ingest`** (multipart `text` e/ou `file`; nenhum → 422):
   grava `ai_extractions` (modelo, `PROMPT_VERSION`, saída bruta, tokens, `status`, `error_code`) e
   os `drafts` `pending` (`payload_json` guarda a proposta e os sinais acima); responde
   `IngestResult`. Falha da IA → grava a extração com o erro e responde 503 `AiError`
   (`ai_limit_reached` com "O limite mensal da IA foi atingido. Lance pelo formulário." ou
   `ai_unavailable`). `GET /ingest/{extraction_id}`: quem enviou ou admin; senão 404.
   *Check*: para **cada** fixture, `count(transactions)` igual antes e depois.

7. **Confirmar / descartar**:
   - `POST /drafts/{id}/confirm` (corpo opcional = proposta editada): rascunho travado
     (`SELECT … FOR UPDATE`); só `pending` (senão 409); só quem enviou ou admin (senão 403);
     conta obrigatória (422); cria via `create_transaction(..., source="chat", attachment_id,
     ai_extraction_id)` — permissões e auditoria vêm de lá; marca `confirmed`, `resolved_by/at`;
     audita o rascunho (`entity="drafts"`, `update`). Confirmar não marca conta a pagar como paga
     (a U6 oferece isso pelo `/bill-instances/{id}/pay`).
   - `POST /drafts/confirm-batch`: tudo ou nada numa transação; 409 se algum não estiver `pending`.
   - `POST /drafts/{id}/discard`: `pending` → `discarded`; senão 409.
   *Check*: confirmar duas vezes cria 1 lançamento; Ruth não confirma rascunho em conta do Matheus
   (403); lote com um rascunho já descartado não cria nenhum.

8. **Fixtures** (`tests/fixtures/ai/*.json`, respostas gravadas, dados fictícios): comprovante,
   extrato com várias linhas, fatura de cartão, texto livre, "other" sem lançamentos, Pix
   Sonia → Matheus. **Teste `-m live`** (opcional, `./tasks.ps1 ai-live`): 3 documentos sintéticos
   (comprovante, extrato curto, texto livre) contra a API real; pulado sem `OPENAI_API_KEY`.

## Pronto quando
`./tasks.ps1 check` verde; nenhum caminho grava sem confirmação (teste por fixture); 429 de limite
não repete; fixtures cobrem os 5 tipos; Sonia → Matheus vira `transfer`; nenhum segredo no contexto.
O modelo da OpenAI é escolhido pelo lead depois (docs e preços atuais), via `OPENAI_MODEL`.
