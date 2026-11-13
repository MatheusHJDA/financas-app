import { formatCents } from "../chat/money";
import type { PlanProjection, Scenario } from "./planApi";
import { monthLongLabel } from "./planMath";

export const SCENARIO_LABEL: Record<Scenario, string> = {
  amortize_now: "Amortizar agora",
  no_amortization: "Sem amortizar",
};

/** Mês de quitação por extenso ("abril de 2027") ou aviso de que não quita no período. */
function payoffText(p: PlanProjection): string {
  return p.payoff_month ? monthLongLabel(p.payoff_month) : "Não quita no período";
}

function lastMonth(p: PlanProjection) {
  return p.months[p.months.length - 1];
}

interface SummaryProps {
  scenario: Scenario;
  selected: PlanProjection;
  amortizeNow: PlanProjection;
  initialAmortizationCents: number;
}

// Resumo no topo: mês de quitação, juros pagos, juros economizados e o aviso D14.
export function PlanSummary({ scenario, selected, amortizeNow, initialAmortizationCents }: SummaryProps) {
  return (
    <section className="card plan-summary" aria-labelledby="plan-resumo">
      <h2 id="plan-resumo">Resumo · {SCENARIO_LABEL[scenario]}</h2>
      <dl className="plan-stats">
        <div>
          <dt>Mês de quitação</dt>
          <dd>{payoffText(selected)}</dd>
        </div>
        <div>
          <dt>Juros pagos no período</dt>
          <dd>{formatCents(selected.total_interest_cents)}</dd>
        </div>
        <div>
          <dt>Juros economizados amortizando agora</dt>
          <dd>{formatCents(amortizeNow.interest_saved_cents)}</dd>
        </div>
      </dl>
      <p className="plan-d14" role="note">
        Cada mês sem amortizar os {formatCents(initialAmortizationCents)} custa cerca de{" "}
        {formatCents(amortizeNow.waiting_cost_per_month_cents)} de juros.
      </p>
    </section>
  );
}

interface ComparisonProps {
  amortizeNow: PlanProjection;
  noAmortization: PlanProjection;
}

// "Amortizar agora × sem amortizar": prazo e juros lado a lado no mesmo período.
export function PlanComparison({ amortizeNow, noAmortization }: ComparisonProps) {
  const interestDiff = noAmortization.total_interest_cents - amortizeNow.total_interest_cents;
  const months = amortizeNow.months.length;
  return (
    <section aria-labelledby="plan-comparacao" className="plan-compare">
      <h2 id="plan-comparacao">Amortizar agora × sem amortizar</h2>
      <table>
        <caption className="sr-only">Comparação dos dois cenários em {months} meses</caption>
        <thead>
          <tr>
            <th scope="col">Medida</th>
            <th scope="col">Amortizar agora</th>
            <th scope="col">Sem amortizar</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Quitação</th>
            <td>{payoffText(amortizeNow)}</td>
            <td>{payoffText(noAmortization)}</td>
          </tr>
          <tr>
            <th scope="row">Juros em {months} meses</th>
            <td>{formatCents(amortizeNow.total_interest_cents)}</td>
            <td>{formatCents(noAmortization.total_interest_cents)}</td>
          </tr>
          <tr>
            <th scope="row">Saldo devedor no fim</th>
            <td>{formatCents(lastMonth(amortizeNow).debt_balance_cents)}</td>
            <td>{formatCents(lastMonth(noAmortization).debt_balance_cents)}</td>
          </tr>
        </tbody>
      </table>
      {interestDiff > 0 ? (
        <p className="muted">
          Amortizando agora, saem {formatCents(interestDiff)} a menos de juros nesses {months} meses.
        </p>
      ) : null}
    </section>
  );
}
