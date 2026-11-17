import { useQuery } from "@tanstack/react-query";
import { Landmark, Target } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { Avatar, Card, ErrorState, ListItem, Money, Skeleton, SkeletonGroup } from "../../ui";
import { OWNER_LABEL } from "./format";

const MAX_ITEMS = 3;

async function loadDebts() {
  const { data, response } = await api.GET("/debts", { params: { query: { limit: 200 } } });
  if (!data) throw new Error(`HTTP ${response.status}`);
  return data.items;
}

async function loadGoals() {
  const { data, response } = await api.GET("/goals", { params: { query: { limit: 200 } } });
  if (!data) throw new Error(`HTTP ${response.status}`);
  return data.items;
}

function CardSkeleton({ label }: { label: string }) {
  return (
    <div className="ui-card">
      <SkeletonGroup label={label}>
        <Skeleton width="40%" />
        <Skeleton variant="block" height="64px" />
      </SkeletonGroup>
    </div>
  );
}

/** Dívidas e metas: sempre o "agora". O saldo devedor total vem da `/overview`. */
export function DebtsGoalsSummary({ debtsBalanceCents }: { debtsBalanceCents: number }) {
  return (
    <>
      <DebtsCard debtsBalanceCents={debtsBalanceCents} />
      <GoalsCard />
    </>
  );
}

function DebtsCard({ debtsBalanceCents }: { debtsBalanceCents: number }) {
  const debts = useQuery({ queryKey: ["debts", "dashboard"], queryFn: loadDebts });
  if (debts.isLoading) return <CardSkeleton label="Carregando dívidas" />;
  if (debts.isError) {
    return (
      <Card title="Dívidas" icon={Landmark}>
        <ErrorState message="Não foi possível carregar as dívidas." onRetry={() => void debts.refetch()} />
      </Card>
    );
  }
  const items = debts.data ?? [];
  return (
    <Card title="Dívidas" icon={Landmark} className="dash-debts">
      {items.length === 0 ? (
        <p className="muted dash-empty">Nenhuma dívida cadastrada.</p>
      ) : (
        <>
          <p className="dash-total">
            <span className="muted">Saldo devedor</span>
            <Money cents={debtsBalanceCents} />
          </p>
          <div className="dash-list">
            {items.slice(0, MAX_ITEMS).map((d) => (
              <Link key={d.id} to={`/dividas/${d.id}`} className="dash-debt-link">
                <ListItem
                  leading={<Avatar name={d.name} tone="expense" />}
                  title={d.name}
                  subtitle={OWNER_LABEL[d.owner]}
                  trailing={<Money cents={d.current_balance_cents} />}
                />
              </Link>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function GoalsCard() {
  const goals = useQuery({ queryKey: ["goals", "dashboard"], queryFn: loadGoals });
  if (goals.isLoading) return <CardSkeleton label="Carregando metas" />;
  if (goals.isError) {
    return (
      <Card title="Metas" icon={Target}>
        <ErrorState message="Não foi possível carregar as metas." onRetry={() => void goals.refetch()} />
      </Card>
    );
  }
  const active = (goals.data ?? []).filter((g) => g.active);
  return (
    <Card
      title="Metas"
      icon={Target}
      className="dash-goals"
      action={
        <Link to="/metas" className="dash-link">
          Ver tudo <span className="visually-hidden">de metas</span>
        </Link>
      }
    >
      {active.length === 0 ? (
        <p className="muted dash-empty">Nenhuma meta ativa.</p>
      ) : (
        <ul className="dash-goal-list">
          {active.slice(0, MAX_ITEMS).map((g) => {
            const percent = Math.round(g.progress.percent);
            // Teto de gasto estourado é ruim; nas demais metas passar de 100% é bom.
            // Decide pelos centavos (como GoalCard): 99,5% arredonda para 100 mas não estourou.
            const over = g.type === "category_cap" && g.progress.current_cents > g.progress.target_cents;
            return (
              <li key={g.id} className="dash-goal">
                <div className="dash-goal__head">
                  <span className="dash-goal__name">{g.name}</span>
                  <span className={over ? "dash-goal__pct dash-neg" : "dash-goal__pct"}>
                    {percent}%{over ? " · teto estourado" : ""}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label={`Progresso de ${g.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.min(100, percent)}
                  aria-valuetext={over ? `${percent}% · teto estourado` : undefined}
                  className="dash-bar"
                >
                  <div className={over ? "dash-bar__fill dash-bar__fill--over" : "dash-bar__fill"} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
                </div>
                <p className="dash-goal__sub muted">
                  <Money cents={g.progress.current_cents} /> de <Money cents={g.progress.target_cents} />
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
