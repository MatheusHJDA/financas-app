# Ajustes após os testes nos aparelhos — desenho curto

Data: 17/11/2026. Branch `emprestimo`. Origem: `docs/referencia/correcoes/correcoes-pendentes.txt` (Matheus).
Os defeitos (início na edição, forma de pagamento, rolagem no PC, botões do chat) já foram corrigidos em `2b7fe85`.
Avisos no iPhone: era a notificação desligada no aparelho — nada a fazer.

## 1. Lembrete da meta Uber (decidido com Matheus: 21h, ajustável)
- Por quê: Matheus quer registrar no fim do dia quanto rodou, para a meta diária "Uber diário" (income_period, daily,
  categoria Uber/99, dono MATHEUS) refletir o dia.
- Como (chamada do lead): reaproveitar o aviso diário existente (`notifications/service.py::_run_daily`, horário
  `notify.daily_time`, padrão 21:00, já ajustável em Administração → Configurações). Para cada usuário que tem meta
  `income_period` diária visível a ele, o corpo ganha uma linha "Uber diário hoje: R$ 110,00 de R$ 130,00 — quanto
  rodou?" e o `url` vira `/lancar?meta=<id>` (se houver mais de uma, a primeira por id).
- `/lancar?meta=<id>` abre "Lançar à mão" já como receita, categoria da meta, data de hoje, dono da meta; falta só o valor.
- Fora: horário por pessoa; aviso separado.

## 2. Filtro em Contas fixas (decidido: Situação e Categoria)
- Dois filtros no topo: Situação (Todas / A pagar / Pagas / Vencidas, do mês atual) e Categoria (lista). Valem para
  "A pagar" e "Cadastradas". "Limpar" volta a tudo. Filtro só na tela (sem API nova); lembrado por aparelho
  (localStorage, opcional).

## 3. Tela de Categorias (decidido: os dois editam)
- Mais → Categorias e menu lateral. Duas listas (Receitas, Despesas): criar, renomear, excluir. API existente
  (`/categories`). Excluir em uso → 409 "A categoria está em uso." (a tela explica). Lead: incluir metas
  (`goals.linked_category_id`) na checagem de uso da API, hoje ausente.
- Fora: subcategorias, cores, mudar tipo de categoria com lançamentos.

## 4. Puxar para atualizar (celular)
- Com a página no topo, puxar para baixo mostra um indicador; ao soltar além do limite, invalida todas as consultas
  (TanStack Query) e pede atualização do service worker. Só em telas touch/< 1024px; não interfere em Sheets abertos
  nem em rolagem interna.

## Aproximações consideradas
- Lembrete: aviso novo com horário próprio (mais configuração, duplicaria o das 21h) × linha no aviso diário
  (escolhida: zero configuração nova).
- Puxar para atualizar: biblioteca externa × gesto próprio pequeno (escolhido: sem dependência nova).
