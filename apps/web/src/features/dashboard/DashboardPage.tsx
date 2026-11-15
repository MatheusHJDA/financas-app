import { useQuery } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import {
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  MonthSwitcher,
  Skeleton,
  SkeletonGroup,
  useHideValues,
} from "../../ui";
import { DESKTOP_QUERY, useMediaQuery } from "../../ui/useMediaQuery";
import { useMonthReport } from "../reports/api";
import { BalanceHero } from "./BalanceHero";
import { DebtsGoalsSummary } from "./DebtsGoalsSummary";
import { MonthCards } from "./MonthCards";
import { MonthCharts } from "./MonthCharts";
import { MonthInsight } from "./MonthInsight";
import { UpcomingBills } from "./UpcomingBills";
import { currentMonth } from "./format";
import "./dashboard.css";

async function loadOverview() {
  const { data, response } = await api.GET("/overview");
  if (!data) throw new Error(`HTTP ${response.status}`);
  return data;
}

function HeroSkeleton() {
  return (
    <div className="ui-card dash-hero-skel">
      <SkeletonGroup label="Carregando saldos">
        <Skeleton width="35%" />
        <Skeleton width="45%" height="0.9em" />
        <Skeleton width="70%" height="2rem" />
        <Skeleton width="40%" height="1.5rem" />
      </SkeletonGroup>
    </div>
  );
}

function MonthSkeleton() {
  return (
    <SkeletonGroup label="Carregando o mês">
      <div className="dash-stats">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} variant="block" height="92px" />
        ))}
      </div>
      <Skeleton width="80%" />
    </SkeletonGroup>
  );
}

/** Início: quanto temos agora (saldo do casal) e como está o mês escolhido. */
export default function DashboardPage() {
  const { me } = useAuth();
  const { hidden, toggle } = useHideValues();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const thisMonth = currentMonth();
  const [month, setMonth] = useState(thisMonth);

  const overview = useQuery({ queryKey: ["overview"], queryFn: loadOverview });
  const report = useMonthReport(month);
  const empty = report.data !== undefined && report.data.income_cents === 0 && report.data.expense_cents === 0;

  return (
    <section className="dash">
      <header className="dash-head">
        <div>
          <h1>Início</h1>
          {me ? <p className="muted dash-greeting">Olá, {me.name}</p> : null}
        </div>
        {/* No computador o olho fica no cabeçalho da casca. */}
        {desktop ? null : (
          <IconButton
            icon={hidden ? Eye : EyeOff}
            label={hidden ? "Mostrar valores" : "Ocultar valores"}
            onClick={toggle}
          />
        )}
      </header>

      <div className="dash-grid">
        <div className="dash-balance">
          {overview.isLoading ? <HeroSkeleton /> : null}
          {overview.isError ? (
            <ErrorState message="Não foi possível carregar os saldos." onRetry={() => void overview.refetch()} />
          ) : null}
          {overview.data ? <BalanceHero overview={overview.data} /> : null}
        </div>

        <div className="dash-month">
          <MonthSwitcher month={month} onChange={setMonth} max={thisMonth} />
          {report.isLoading ? <MonthSkeleton /> : null}
          {report.isError ? (
            <ErrorState message="Não foi possível carregar o mês." onRetry={() => void report.refetch()} />
          ) : null}
          {report.data ? (
            <>
              <MonthCards report={report.data} />
              {empty ? (
                <Card className="dash-invite">
                  <EmptyState
                    title="Nenhum lançamento neste mês"
                    hint="Registre receitas e despesas para ver o resumo e os gráficos."
                    action={
                      <Link to="/lancar" className="ui-btn ui-btn--primary">
                        Lance sua primeira despesa
                      </Link>
                    }
                  />
                </Card>
              ) : (
                <MonthInsight report={report.data} />
              )}
            </>
          ) : null}
        </div>

        {desktop && !empty && !report.isError ? <MonthCharts report={report.data} loading={report.isLoading} /> : null}

        {overview.data ? (
          <>
            <UpcomingBills upcoming={overview.data.upcoming_bills} overdue={overview.data.overdue_bills} />
            <DebtsGoalsSummary debtsBalanceCents={overview.data.debts_balance_cents} />
          </>
        ) : null}
      </div>
    </section>
  );
}
