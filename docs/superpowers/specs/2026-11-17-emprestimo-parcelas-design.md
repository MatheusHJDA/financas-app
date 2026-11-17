# Empréstimo com parcelas — desenho

Data: 17/11/2026. Branch de partida: `redesenho`.

## Por quê

Matheus e Ruth pagam um empréstimo do Nubank (R$ 22.000 escolhidos + IOF = R$ 22.659,65 contratados, juros de
3,45% a.m.). Toda semana, conforme o que rendeu o Uber, eles **adiantam as últimas parcelas**, que saem com
desconto de juros. Hoje o app guarda só um número fixo de saldo devedor (`debts.current_balance_cents`), que não
muda quando pagam, e não tem tela de dívidas — só o resumo no Início. Os dados atuais também estão errados
(parcela R$ 1.362,82, saldo R$ 22.000). Eles querem ver no app o mesmo que o app do Nubank mostra (referência:
`docs/referencia/visual/emprestimo/`, 3 capturas de 17/11/2026) e registrar ali os adiantamentos.

## O que eles querem ver (decidido com Matheus)

1. **Topo do empréstimo:** restante a pagar (soma do valor cheio das parcelas em aberto), total pago, quanto
   custaria quitar hoje.
2. **Lista de todas as parcelas:** nº, vencimento, valor cheio, **valor hoje** (trazido a valor presente pela taxa
   contratada, recalculado a cada dia) e economia (cheio − hoje). Parcelas pagas/adiantadas aparecem marcadas,
   com a data e o valor efetivamente pago.
3. **Adiantar parcelas:** marcar quais (normalmente as últimas), ver total e economia estimados, confirmar
   informando o **valor real cobrado pelo Nubank** (pré-preenchido com a estimativa) e a conta de onde saiu.
4. **Parcela do mês:** paga **à mão** (não há débito automático). Ela aparece em **Contas fixas** com aviso de
   vencimento, como as outras contas, e pode ser marcada como paga lá ou na tela do empréstimo.
5. Todo pagamento (mensal ou adiantamento) vira **despesa na conta escolhida**, categoria `Dívidas/Empréstimo`
   (id 16), para o saldo da conta e os relatórios ficarem certos.

## Dados de partida (das capturas, 17/11/2026)

- 13 parcelas em aberto, valor cheio **R$ 1.417,57** cada (13 × 1.417,57 = 18.428,41; o Nubank mostra
  18.428,42 — a diferença de 1 centavo fica numa parcela, a ser confirmada com Matheus no carregamento).
- Vencimentos: 18/12/2026, 18/01/2027, 18/02, 18/03, 19/04, 18/05, 18/06, 19/07, 18/08, 20/09, 18/10, 18/11,
  20/12/2027.
- Taxa 3,45% a.m.; total já pago antes do app: **R$ 8.187,99** (sem lançamentos — é anterior ao app).
- Valores "hoje" mostrados pelo Nubank em 17/11/2026 (servem de teste de calibração): 1ª 1.368,80; 2ª 1.323,15;
  3ª 1.279,02; 4ª 1.236,37; 5ª 1.195,14; 6ª 1.155,28; 7ª 1.116,75; 8ª 1.079,51; 9ª 1.043,51; 10ª 1.008,71;
  11ª 975,07; 12ª 942,55; 13ª 911,12; todas = 14.634,95.
- Conta de onde sai: `Nubank (Matheus)` (id 1, dono AMBOS). Dívida atual: `debts.id = 1`, dono AMBOS.

## Objetivos

- O empréstimo do Nubank no app bate com o app do Nubank (restante, total pago, parcelas e datas).
- Adiantar parcelas em poucos toques, no celular, toda semana.
- Parcela do mês avisada e paga pelo mesmo fluxo de Contas fixas (aviso, Início, relatório "Contas pagas").

## Fora do escopo

- Os dois cartões em `debts` (Santander, Sicredi) continuam como estão (só saldo). O modelo novo é opcional por
  dívida: dívida sem parcelas cadastradas se comporta como hoje.
- Amortização parcial de uma parcela (o Nubank só adianta parcelas inteiras).
- Ligar o Plano (`plan/`) ao novo modelo — continua com suas premissas manuais.
- Importar os pagamentos anteriores como lançamentos.

## Anti-objetivos (seria fracasso mesmo funcionando)

- A parcela aparecer em dois lugares com estados diferentes (paga no empréstimo e aberta em Contas fixas, ou
  vice-versa).
- Contas fixas continuar cobrando uma parcela que já foi adiantada.
- Lançamento duplicado ao pagar (um pagamento = uma despesa).
- O valor estimado ser gravado no lugar do valor real que o Nubank cobrou.

## Abordagens consideradas

1. **Parcelas guardadas no empréstimo; Contas fixas as mostra (escolhida por Matheus).** Uma fonte só por parcela;
   vencimentos irregulares do Nubank respeitados; adiantar a 13ª tira ela do mês dela automaticamente.
2. Conta fixa comum de R$ 1.417,57 + tela do empréstimo à parte. Mais simples, mas duas fontes que se
   desencontram a cada adiantamento semanal, e vencimento sempre no mesmo dia. Descartada.
3. Só calculadora (sem guardar parcelas). Perde histórico do que foi pago. Descartada.

## Como (decisões)

**Decidido com Matheus:** abordagem 1; pagamento à mão; todo pagamento vira despesa numa conta.

**Chamadas do lead (o construtor pode contestar com motivo):**

- **Tabela nova `debt_installments`**: `debt_id`, `number`, `due_date`, `face_cents`, `status`
  (`open` | `paid` | `prepaid`), `paid_cents`, `paid_on`, `transaction_id`, `bill_instance_id`. Na dívida:
  `paid_before_app_cents` (R$ 8.187,99). `monthly_rate` já existe (0.0345).
- **Integração com Contas fixas por meio de `bill_instances`**, para não mexer em cada consumidor (Início,
  relatórios, avisos, chat de pagamento já leem `bill_instances`): a dívida com parcelas ganha uma
  `recurring_bills` própria marcada como gerida pela dívida (ex.: coluna `debt_id`), e cada parcela tem a sua
  `bill_instance` com `due_date` e `amount_cents` da parcela. O gerador mensal (`ensure_bill_instances`) **pula**
  essas contas; editar/excluir essa conta fixa pela tela de Contas fixas é bloqueado (aponta para a tela do
  empréstimo). Pagar a instância em Contas fixas (`/bill-instances/{id}/pay`) marca a parcela como `paid`;
  pagar/adiantar pela tela do empréstimo marca a instância como `paid` com o mesmo lançamento. Um único serviço
  faz as duas coisas numa transação de banco.
- **Saldo devedor da dívida** (Início, `/overview`, metas `debt_payoff`): para dívida com parcelas, passa a ser a
  soma do valor cheio das parcelas abertas ("restante a pagar", como o Nubank). `current_balance_cents` fica
  derivado/atualizado por esse serviço.
- **Valor hoje** calculado no servidor: `face / (1 + i)^(meses inteiros + dias/30)` contados da data de hoje (fuso
  de SP) ao vencimento. Medido contra o Nubank: erra ≤ 4 centavos nas 3 primeiras e até ~R$ 2 nas mais
  distantes. Meta: erro ≤ 0,3% por parcela contra a tabela acima; o construtor pode calibrar a fórmula. Na tela o
  valor aparece como estimativa; o gravado é sempre o valor digitado.
- **Adiantar**: pedido com lista de parcelas + valor total real + conta + data; gera **uma** despesa com descrição
  "Empréstimo Nubank — adiantamento parcelas 12ª, 13ª" e reparte `paid_cents` entre as parcelas proporcionalmente
  à estimativa (o último centavo na última). Desfazer = excluir o lançamento, que volta as parcelas para `open`.
- **Vínculo parcela ↔ lançamento (resposta à revisão)**: a fonte da verdade é `debt_installments.transaction_id`
  (uma despesa pode pagar várias parcelas). A regra 1:1 de `transactions.bill_instance_id` /
  `pay_bill_instance` continua só para contas fixas comuns; para instâncias geridas pela dívida, o caminho de
  liberar (`release_bill_instance`, `transactions/service.py`) passa pelas parcelas: excluir a despesa reabre
  todas as parcelas dela (e suas instâncias); editar o valor reparte de novo `paid_cents`; editar a data só muda
  `paid_on`.
- **Pagar pela tela de Contas fixas** uma instância gerida pela dívida abre o mesmo formulário do empréstimo:
  valor real (pré-preenchido com o valor hoje), conta e data. Se for vinculado a uma despesa já lançada,
  `paid_cents` = valor dessa despesa.
- **Mês do relatório (decidido com Matheus):** pagamento entra no relatório do **mês em que o dinheiro saiu**
  (a despesa, pela data dela). A instância de uma parcela adiantada fica num estado próprio (`prepaid`, novo
  valor em `bill_status`, ou equivalente): no mês do vencimento ela aparece como "Adiantada", **sem somar** em
  "Contas pagas" nem em "a pagar", e não gera aviso. Isto exige ajustar os consumidores de `bill_instances`
  (Início/`UpcomingBills`, `reports/`, `overview/`, `notifications/`, chat de pagamento) para tratar esse estado.
  Parcela paga no próprio mês do vencimento conta normalmente como "paga".
- **Total pago** = `paid_before_app_cents` + soma de `paid_cents` (o que saiu da conta), não o valor cheio.
- **Tela**: rota `/emprestimo/:id` (ou `/dividas/:id`), entrada pelo card "Dívidas" do Início e por Mais. Lista em
  ordem de vencimento; adiantadas ao fim com selo. Barra fixa embaixo com total selecionado, economia e
  "Revisar", como no Nubank. Usa o kit `apps/web/src/ui/` e `Money` (olho de ocultar valores).
- **Carga dos dados**: migração Alembic para o esquema + script/rota admin que recadastra o empréstimo (id 1) com
  as 13 parcelas, a taxa e o total já pago. Backup antes (`./tasks.ps1 backup`).
- Permissões: as mesmas de hoje para lançamentos e dívidas (dono AMBOS: os dois podem pagar; `ensure_can_write`).

## Deixado ao construtor

Nomes de campos e rotas, forma exata da fórmula de valor presente (dentro da meta de erro), layout fino da tela,
mensagens, testes. Seguir os padrões do repo: dinheiro em centavos inteiros, auditoria (`record_audit`), TDD,
`./tasks.ps1 check` e e2e verdes nos 3 aparelhos.
