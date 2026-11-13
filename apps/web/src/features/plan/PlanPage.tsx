import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, LoadingState } from "../../ui/States";
import "./plan.css";
import { AssumptionsForm } from "./AssumptionsForm";
import { MonthList } from "./MonthList";
import { PlanComparison, PlanSummary, SCENARIO_LABEL } from "./PlanSummary";
import {
  assumptionsKey,
  fetchAssumptions,
  fetchProjection,
  projectionKey,
  type Scenario,
} from "./planApi";

const SCENARIOS: Scenario[] = ["amortize_now", "no_amortization"];

// Dono: U10. Aba Plano: resumo, amortizar agora × sem amortizar, mês a mês e premissas.
export default function PlanPage() {
  const [scenario, setScenario] = useState<Scenario>("amortize_now");
  const [editing, setEditing] = useState(false);

  const assumptions = useQuery({ queryKey: assumptionsKey(), queryFn: fetchAssumptions });
  const amortizeNow = useQuery({
    queryKey: projectionKey("amortize_now"),
    queryFn: () => fetchProjection("amortize_now"),
  });
  const noAmortization = useQuery({
    queryKey: projectionKey("no_amortization"),
    queryFn: () => fetchProjection("no_amortization"),
  });
  const queries = [assumptions, amortizeNow, noAmortization];

  const retry = () => queries.forEach((q) => void q.refetch());
  const header = (
    <>
      <h1>Plano</h1>
      <p className="muted">Quanto sobra, quando o empréstimo quita e quanto custa esperar.</p>
    </>
  );

  if (queries.some((q) => q.isError)) {
    return (
      <section className="screen plan">
        {header}
        <ErrorState message="Não foi possível carregar o Plano." onRetry={retry} />
      </section>
    );
  }

  const a = assumptions.data;
  const now = amortizeNow.data;
  const none = noAmortization.data;
  if (!a || !now || !none) {
    return (
      <section className="screen plan">
        {header}
        <LoadingState label="Carregando o Plano…" />
      </section>
    );
  }

  const selected = scenario === "amortize_now" ? now : none;

  return (
    <section className="screen plan">
      {header}

      <div className="plan-toggle" role="group" aria-label="Cenário mostrado">
        {SCENARIOS.map((s) => (
          <button
            key={s}
            type="button"
            className="btn"
            aria-pressed={scenario === s}
            onClick={() => setScenario(s)}
          >
            {SCENARIO_LABEL[s]}
          </button>
        ))}
      </div>

      <PlanSummary
        scenario={scenario}
        selected={selected}
        amortizeNow={now}
        initialAmortizationCents={a.initial_amortization_cents}
      />
      <PlanComparison amortizeNow={now} noAmortization={none} />
      <MonthList months={selected.months} />

      <section aria-labelledby="plan-premissas" className="plan-assumptions">
        <h2 id="plan-premissas">Premissas</h2>
        {editing ? (
          <AssumptionsForm assumptions={a} onDone={() => setEditing(false)} />
        ) : (
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            Editar premissas
          </button>
        )}
      </section>
    </section>
  );
}
