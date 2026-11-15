import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil, SlidersHorizontal } from "lucide-react";
import { Button, Card, Chip, ChipGroup, ErrorState, Skeleton, SkeletonGroup } from "../../ui";
import "./plan.css";
import { AssumptionsForm } from "./AssumptionsForm";
import { MonthList } from "./MonthList";
import { PlanChart } from "./PlanChart";
import { PlanComparison, PlanSummary, SCENARIO_LABEL } from "./PlanSummary";
import {
  assumptionsKey,
  fetchAssumptions,
  fetchProjection,
  projectionKey,
  type Scenario,
} from "./planApi";

const SCENARIOS: Scenario[] = ["amortize_now", "no_amortization"];

/** Esqueleto com a forma do Plano: chips, resumo com destaque, gráfico e blocos do mês a mês. */
function PlanSkeleton() {
  return (
    <SkeletonGroup label="Carregando o Plano…">
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <Skeleton variant="block" height="40px" />
        <Skeleton variant="block" height="40px" />
      </div>
      <Skeleton variant="block" height="180px" />
      <Skeleton variant="block" height="220px" />
      <Skeleton variant="block" />
      <Skeleton variant="block" />
    </SkeletonGroup>
  );
}

// Dono: U10/U20. Plano: quitação em destaque, saldo devedor mês a mês, comparação e premissas.
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
        <PlanSkeleton />
      </section>
    );
  }

  const selected = scenario === "amortize_now" ? now : none;

  return (
    <section className="screen plan">
      {header}

      <ChipGroup label="Cenário mostrado">
        {SCENARIOS.map((s) => (
          <Chip key={s} selected={scenario === s} onClick={() => setScenario(s)}>
            {SCENARIO_LABEL[s]}
          </Chip>
        ))}
      </ChipGroup>

      <div className="plan-top">
        <PlanSummary
          scenario={scenario}
          selected={selected}
          amortizeNow={now}
          initialAmortizationCents={a.initial_amortization_cents}
        />
        <PlanChart months={selected.months} payoffMonth={selected.payoff_month ?? null} />
      </div>
      <PlanComparison amortizeNow={now} noAmortization={none} />
      <MonthList months={selected.months} />

      <Card title="Premissas" icon={SlidersHorizontal} className="plan-assumptions">
        {editing ? (
          <AssumptionsForm assumptions={a} onDone={() => setEditing(false)} />
        ) : (
          <Button icon={Pencil} block onClick={() => setEditing(true)}>
            Editar premissas
          </Button>
        )}
      </Card>
    </section>
  );
}
