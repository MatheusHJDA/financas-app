# Redesenho da interface — desenho (14/11/2026)

## Intenção e porquê
Matheus acha a interface atual "arcaica" (abas com emoji, cartões cinza com borda, spinner em tudo, uma coluna de 640px).
Quer o app com a cara do Despezzas (despezzas.com; referências em `docs/referencia/visual/`): botões e cartões bem
arredondados, menus com ícones, um botão central com uma estrela de IA para lançar despesas, Skeleton Screen no
carregamento, gráficos e elementos visuais, e um **painel web** no computador como o do Despezzas.
Usuários: Matheus (admin) e Ruth. Uso real começa em dez/26.

## Decidido com o Matheus
- **Um app só, dois layouts** (opção 1): no celular, barra de baixo; no computador, painel com menu lateral. A
  administração vira item do menu lateral, só para admin.
- **Evoluir o que existe** (abordagem A): CSS puro + tokens, `lucide-react` para ícones, Recharts para gráficos, um
  kit de componentes próprio. Sem Tailwind, sem biblioteca de componentes.
- Reorganizar as telas (não só trocar a pele). Gráficos e elementos visuais como os do Despezzas são bem-vindos.
- Se o resultado não bastar, avaliamos uma "versão 2" depois (fora deste projeto).

## Objetivos
1. Visual moderno parecido com o Despezzas, em claro e escuro.
2. Navegação com ícones; botão central ✦ (estrela de quatro pontas própria, com degradê) que abre o lançamento com IA.
3. Skeleton Screen em todo carregamento de tela/seção (o spinner fica só para ações curtas, como "Salvando").
4. Painel no computador (≥ 1024px): menu lateral + grade de cartões.
5. Início/Dashboard com saldo em destaque, cartões de receitas/despesas, seletor de mês com setas, gráficos.
6. Tela de Relatórios com rosca por categoria e filtros de período.

## Não objetivos
- Open Finance, cartões de crédito como entidade nova, tags, investimentos, limites de gasto, indicação.
- Mudar regras de dinheiro, permissões (D6), IA ou notificações.
- App nativo; o PWA continua.

## Anti-objetivos (falha mesmo que "funcione")
- Copiar marca, logo, nome ou ilustrações do Despezzas, ou o logo do Gemini. O ✦ é desenho próprio.
- Perder funções que existem hoje (qualquer ação atual precisa continuar alcançável).
- Quebrar a regra de rolagem horizontal zero em 360–414px, ou alvos de toque < 48px.
- Telas que "piscam" (skeleton com forma diferente do conteúdo final, ou layout que pula).
- Valores de dinheiro calculados no front (somas e agregações vêm da API, em centavos).

## Restrições
- Stack atual: React 18, Vite, react-router 7, TanStack Query, openapi-fetch, CSS puro por feature, Vitest, e2e
  Playwright em `apps/api/tests/e2e` (viewports 414×896 e 412×915). Backend FastAPI.
- Contrato da API em `docs/api/openapi.yaml` é a fonte; o front gera tipos com `npm run gen:api`.
- PWA offline: fonte embutida no bundle (`@fontsource-variable/inter`), nada de CDN.
- `tasks.ps1 check` e `tasks.ps1 e2e` continuam verdes ao fim de cada onda.
- Commit de cada onda só com o ok do Matheus, sem `.claude/settings.json`.

## Abordagens consideradas
| | Abordagem | Troca | Decisão |
|---|---|---|---|
| A | Evoluir: tokens + kit próprio + lucide-react + Recharts | pouca reescrita; kit precisa de disciplina | **escolhida** |
| B | Tailwind + shadcn/ui | visual pronto mais rápido; reescreve ~40 telas, convivência de dois CSS, risco no e2e | descartada |
| C | A com gráficos SVG à mão | bundle menor; tooltip/eixos/animação por nossa conta | descartada (reavaliar se o bundle pesar) |

## O desenho

### Linguagem visual (chamada do lead)
- Fundo cinza bem claro (`#f4f6f5`), cartões brancos sem borda com sombra suave, raio 16px (cartões) e pílula
  (botões, chips, barra). Escuro: fundo `#0d1110`, cartões `#161c1b`.
- Cor primária: verde próprio (`#16a34a`-ish, ajustar contraste AA); receita verde, despesa vermelha
  (`#dc2626`), "a receber" azul, "pago" laranja — como os cartões coloridos do Despezzas.
- Fonte Inter variável; números grandes (saldo ~2rem/700) com `font-variant-numeric: tabular-nums`.
- Ícones lucide (traço 1.75) em todo menu, cabeçalho de cartão e item de lista; ícone em "bolha" colorida nos
  cartões de número.
- Movimento curto (150–200ms), respeitando `prefers-reduced-motion`.

### Kit de componentes (`apps/web/src/ui/`)
`Button` (primário/secundário/fantasma/perigo, pílula), `IconButton` (redondo), `Card` (com cabeçalho: ícone + título
+ ação), `StatCard` (ícone em bolha + rótulo + valor, cor por tipo), `Money` (formata centavos, opção de ocultar com
o "olho"), `Chip`/`ChipGroup` (filtros: Hoje/Ontem, Esse mês/Mês passado/Período), `MonthSwitcher` (setas + mês),
`Skeleton` (linha, bloco, círculo; com `aria-busy`), `Sheet` (painel de baixo no celular / modal no computador),
`ListItem` (avatar/ícone + título + subtítulo + valor), `EmptyState`/`ErrorState` restilizados,
`SparkleIcon` (✦ próprio). Gráficos em `ui/charts/`: `DonutChart`, `LineChart` (este mês × mês passado), `BarChart`
(plano/meses). Cada componente com teste Vitest e uma página de catálogo só em dev (`/dev/kit`).

### Navegação
**Celular (< 1024px)** — barra flutuante em pílula com ícone + rótulo:
`Início · Transações · [✦] · Relatórios · Mais`. O ✦ é um botão maior, em degradê, no centro; abre o lançamento
com IA (a tela de chat atual). "Mais" lista, com ícones: Metas, Plano, Contas fixas, Contas, Notificações,
Instalar no celular, Administração (admin), Sair.

**Computador (≥ 1024px)** — menu lateral fixo com grupos:
- Controle: Dashboard, Transações, Contas fixas, Contas
- Planejamento: Metas, Plano, Relatórios
- IA: Lançar com IA (✦)
- Administração (só admin): Usuários, Configurações, Notificações, IA, Auditoria, Sistema — cada um vira rota
  própria (`/admin/usuarios` …) em vez de botões numa página
- Rodapé: alternar tema, usuário logado + sair.
Cabeçalho: trilha ("Perfil / Dashboard"), sino de avisos, saudação "Olá, Matheus" no Dashboard.

**Rotas**: `/` passa a ser o Dashboard (antes era o chat). Chat vai para `/lancar`. Rotas antigas (`/geral`,
`/mais/admin`) redirecionam para as novas. Proposta do lead: o chat deixa de ser a tela inicial porque o ✦ o deixa a
um toque de qualquer tela.

### Telas
1. **Dashboard/Início**:
   - **Saldo atual** (decidido pelo Matheus): soma dos saldos das contas *agora* (`/overview`
     `couple_total_cents`), com olho para ocultar e "Expandir" por dono (`balances_by_owner`). Não muda com o mês.
   - **MonthSwitcher muda só os cartões do mês e os gráficos** (decidido pelo Matheus). Saldo, contas a
     pagar/atrasadas, dívidas e metas mostram sempre o agora.
   - **Quatro StatCards do mês** (decidido pelo Matheus): Receitas, Despesas (lançamentos do mês), **Contas pagas**
     ("9 de 14" + valor pago) e **A pagar** (valor restante + nº de contas), os dois últimos a partir das
     `bill_instances` do mês. Não há "Recebido"/"Pago" do Despezzas (o app não tem lançamento previsto).
   - Aviso comparativo ("Você gastou R$ X a mais/menos que no mês anterior"); contas a pagar/atrasadas; resumo de
     dívidas e metas (barra de progresso); no computador, grade de 3 colunas com "Ritmo de gasto" (linha) e
     "Top 5 categorias" (rosca).
2. **Transações**: lista agrupada por dia, filtros em chips (mês, dono, tipo, categoria), busca; editar em Sheet.
   Absorve o que hoje está em `TransactionsSection`.
3. **Lançar (✦)**: o chat atual restilizado (balões, compositor flutuante com anexo/microfone se já houver,
   cartões de rascunho); lançamento manual no estilo do formulário do Despezzas (cabeçalho verde para receita,
   vermelho para despesa, valor grande, chips Hoje/Ontem/Data, Único/Recorrente/Parcelado só se já suportado).
4. **Relatórios**: totais Receitas/Saídas/Balanço; chips Esse mês/Mês passado/Período; rosca por categoria com
   lista e percentuais; linha do ritmo de gasto.
5. **Contas fixas** e **Contas**: listas com ListItem e ações em Sheet (mesmas regras de hoje).
6. **Metas** e **Plano**: cartões com progresso; Plano com BarChart dos meses até a quitação e o resumo atual.
7. **Administração**: mesmas seis seções, com layout de painel (tabelas no computador, listas no celular).
8. **Login/PIN**: restilizado (teclado redondo, pontos), sem mudar o fluxo.

### Backend: relatório do mês (novo)
`GET /reports/month?month=YYYY-MM&owner=MATHEUS|RUTH|AMBOS` (owner opcional = visão do casal) devolve, em centavos:
- `income_cents`, `expense_cents`, `balance_cents` (= receitas − despesas do mês; lançamentos `kind` receita/despesa)
- `bills`: `{total_count, paid_count, paid_cents, open_count, open_cents}` das `bill_instances` do mês
- `previous`: `income_cents`, `expense_cents` do mês anterior e `expense_delta_cents`
- `by_category`: `[{category_id, name, total_cents, share_bp}]` de despesas, ordenado desc (share em pontos-base;
  sem categoria = `category_id` null, nome "Sem categoria")
- `daily_cumulative_expense`: `{current: [{day, cents}], previous: [{day, cents}]}` — mês corrente até *hoje*
  (fuso de SP); mês passado completo; meses passados completos; dias sem gasto repetem o acumulado.
Transferências entre contas não contam. **Permissões (chamada do lead)**: as mesmas regras de leitura de
`GET /transactions` (o relatório só agrega o que o usuário já pode listar); nada de 403 novo. Testes de API com casos
de borda (mês sem lançamentos, categoria nula, virada de mês no fuso de SP, transferência ignorada).

O gráfico do Plano usa `PlanProjection.months` (já existe; sem mudança de backend).

## Ondas (para o alethe, detalhadas no plano)
- **R0 — Base (lead)**: tokens, fonte, ícones, kit `ui/`, Skeleton, casca responsiva (barra + menu lateral),
  rotas novas e redirecionamentos, contrato `/reports/month` no openapi. Congelada antes da R1.
- **R1 — Dados e gráficos (paralelo)**: backend `/reports/month`; componentes de gráfico.
- **R2 — Telas (paralelo, worktrees)**: Dashboard; Transações; Lançar (chat + manual); Contas fixas + Contas;
  Metas + Plano; Relatórios; Administração; Login.
- **R3 — Fechamento**: e2e atualizado (celular 414/412 + computador 1280×800), revisão visual/acessibilidade e
  de dinheiro, capturas de tela para o Matheus aprovar.

## Chamadas do lead após a revisão do builder
- Lançamento manual: só Receita/Despesa (+ transferência se já existe); **sem** chips Único/Recorrente/Parcelado
  (`TransactionCreate` não tem recorrência nem parcela). Um link "Conta que se repete? Cadastre em Contas fixas".
  O manual sai de dentro do chat e vira um Sheet aberto pelo Lançar (botão "Lançar à mão").
- Olho de ocultar valores: contexto global lido por `Money`, vale no app inteiro, lembrado no aparelho
  (localStorage com try/catch; padrão = visível).
- Computador: rodapé do menu com **Preferências** (notificações pessoais, instalar no celular, tema) e usuário/sair.
  A seção admin "Notificações" passa a se chamar **"Avisos do sistema"**. O sino do cabeçalho abre a lista de contas
  a pagar/atrasadas.
- Rotas `/admin/*` valem nos dois layouts; no celular, Mais → Administração lista as seis. `/mais/admin` e `/geral`
  redirecionam.
- e2e: a R0 reescreve os seletores de navegação/rotas (`tests/e2e`) para a casca nova e deixa `tasks.ps1 e2e` verde;
  cada onda seguinte mantém verde e adiciona os fluxos das telas que mexe.

## Fica para o builder
Valores exatos de cor/sombra (dentro da linguagem acima e com contraste AA), espaçamentos, ordem fina dos cartões
no Dashboard, textos de vazio/erro, nomes internos de componentes e arquivos, como cada skeleton imita sua tela.
