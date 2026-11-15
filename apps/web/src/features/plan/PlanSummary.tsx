import { CalendarCheck, CalendarX, ClipboardList, Scale } from "lucide-react";
import { Card, Money } from "../../ui";
import { useMoneyText } from "./moneyText";
import type { PlanProjection, Scenario } from "./planApi";
import { monthLongLabel } from "./planMath";

export const SCENARIO_LABEL: Record<Scenario, string> = {
  amortize_now: "Amortizar agora",
  no_amortization: "Sem amortizar",
};

/** Mês de quitação por extenso ("abril de 2027") ou aviso de que não quita no período. */
function payoffText(p: PlanProjection): string {
  return p.payoff_month
    ? monthLongLabel(p.payoff_month)
    : "Não quita no período";
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

// Resumo no topo: quitação em destaque, juros pagos, juros economizados e o aviso D14.
export function PlanSummary({
  scenario,
  selected,
  amortizeNow,
  initialAmortizationCents,
}: SummaryProps) {
  const text = useMoneyText();
  const paysOff = selected.payoff_month != null;
  const HeroIcon = paysOff ? CalendarCheck : CalendarX;
  return (
    <Card
      title={`Resumo · ${SCENARIO_LABEL[scenario]}`}
      icon={ClipboardList}
      className="plan-summary"
    >
      <div className={`plan-hero${paysOff ? "" : " plan-hero--none"}`}>
        <span className="plan-hero__bubble" aria-hidden="true">
          <HeroIcon size={24} strokeWidth={1.75} />
        </span>
        <p className="plan-hero__text">
          {paysOff
            ? `Quitação em ${monthLongLabel(selected.payoff_month as string)}`
            : "Sem quitação dentro do período projetado"}
        </p>
      </div>
      <dl className="plan-stats">
        <div>
          <dt>Mês de quitação</dt>
          <dd>{payoffText(selected)}</dd>
        </div>
        <div>
          <dt>Juros pagos no período</dt>
          <dd>
            <Money cents={selected.total_interest_cents} />
          </dd>
        </div>
        <div>
          <dt>Juros economizados amortizando agora</dt>
          <dd>
            <Money cents={amortizeNow.interest_saved_cents} />
          </dd>
        </div>
      </dl>
      <p className="plan-d14" role="note">
        Cada mês sem amortizar os {text(initialAmortizationCents)} custa cerca
        de {text(amortizeNow.waiting_cost_per_month_cents)} de juros.
      </p>
    </Card>
  );
}

interface ComparisonProps {
  amortizeNow: PlanProjection;
  noAmortization: PlanProjection;
}

// "Amortizar agora × sem amortizar": prazo e juros lado a lado no mesmo período.
export function PlanComparison({
  amortizeNow,
  noAmortization,
}: ComparisonProps) {
  const text = useMoneyText();
  const interestDiff =
    noAmortization.total_interest_cents - amortizeNow.total_interest_cents;
  const months = amortizeNow.months.length;
  return (
    <Card
      title="Amortizar agora × sem amortizar"
      icon={Scale}
      className="plan-compare"
    >
      <div className="plan-compare__scroll">
        <table>
          <caption className="visually-hidden">
            Comparação dos dois cenários em {months} meses
          </caption>
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
              <td>
                <Money cents={amortizeNow.total_interest_cents} />
              </td>
              <td>
                <Money cents={noAmortization.total_interest_cents} />
              </td>
            </tr>
            <tr>
              <th scope="row">Saldo devedor no fim</th>
              <td>
                <Money cents={lastMonth(amortizeNow).debt_balance_cents} />
              </td>
              <td>
                <Money cents={lastMonth(noAmortization).debt_balance_cents} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {interestDiff > 0 ? (
        <p className="muted">
          Amortizando agora, saem {text(interestDiff)} a menos de juros nesses{" "}
          {months} meses.
        </p>
      ) : null}
    </Card>
  );
}
