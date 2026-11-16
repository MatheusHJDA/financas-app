import { ArrowDownCircle, ArrowUpCircle, Scale, TrendingUp } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Card,
  Chip,
  ChipGroup,
  EmptyState,
  ErrorState,
  Skeleton,
  SkeletonGroup,
  StatCard,
  useHideValues,
  monthLabel,
  shiftMonth,
} from "../../ui";
import { useMonthReport, type MonthReport, type Owner } from "./api";
import { CategoryBreakdown } from "./CategoryBreakdown";
import { LazyLineChart } from "./LazyCharts";
import { PeriodChips, type Period } from "./PeriodChips";
import "./reports.css";

const OWNERS: { label: string; value: Owner | undefined }[] = [
  { label: "Todos", value: undefined },
  { label: "Matheus", value: "MATHEUS" },
  { label: "Ruth", value: "RUTH" },
  { label: "Ambos", value: "AMBOS" },
];

/** Mês corrente ("AAAA-MM") no fuso de São Paulo, o mesmo que a API usa para "hoje". */
function currentMonthSP(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}`;
}

function ReportSkeleton() {
  return (
    <SkeletonGroup label="Carregando relatório">
      <div className="rep-stats">
        <Skeleton variant="block" height="72px" />
        <Skeleton variant="block" height="72px" />
        <Skeleton variant="block" height="72px" />
      </div>
      <div className="rep-grid">
        <Skeleton variant="block" height="320px" />
        <Skeleton variant="block" height="240px" />
      </div>
    </SkeletonGroup>
  );
}

function ReportBody({ report, month }: { report: MonthReport; month: string }) {
  const empty = report.by_category.length === 0 && report.income_cents === 0 && report.expense_cents === 0;
  const { current, previous } = report.daily_cumulative_expense;
  const { hidden } = useHideValues(); // olho fechado: o tom do Balanço não denuncia o sinal
  return (
    <>
      <div className="rep-stats">
        <StatCard label="Receitas" icon={ArrowUpCircle} tone="income" cents={report.income_cents} />
        <StatCard label="Saídas" icon={ArrowDownCircle} tone="expense" cents={report.expense_cents} />
        <div className="rep-stats__balance">
          <StatCard
            label="Balanço"
            icon={Scale}
            tone={report.balance_cents < 0 && !hidden ? "expense" : "info"}
            cents={report.balance_cents}
          />
        </div>
      </div>
      {empty ? (
        <Card className="rep-card">
          <EmptyState
            title="Sem lançamentos neste período"
            hint="Quando você lançar receitas e despesas, elas aparecem aqui."
            action={
              <Link to="/lancar" className="ui-btn ui-btn--primary">
                Lançar com IA
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="rep-grid">
          <CategoryBreakdown categories={report.by_category} totalCents={report.expense_cents} />
          <Card title="Ritmo de gasto" icon={TrendingUp} className="rep-card">
            <LazyLineChart
              label="Ritmo de gasto"
              series={[
                {
                  name: monthLabel(month),
                  tone: "expense",
                  points: current.map((p) => ({ x: p.day, cents: p.cents })),
                },
                {
                  name: monthLabel(shiftMonth(month, -1)),
                  tone: "neutral",
                  dashed: true,
                  points: previous.map((p) => ({ x: p.day, cents: p.cents })),
                },
              ]}
            />
          </Card>
        </div>
      )}
    </>
  );
}

export default function ReportsPage() {
  const thisMonth = currentMonthSP();
  const [period, setPeriod] = useState<Period>("current");
  const [customMonth, setCustomMonth] = useState(thisMonth);
  const [owner, setOwner] = useState<Owner | undefined>(undefined);

  const month = period === "current" ? thisMonth : period === "previous" ? shiftMonth(thisMonth, -1) : customMonth;
  const report = useMonthReport(month, owner);

  function choosePeriod(next: Period) {
    // "Escolher mês" começa no mês que já está na tela, para o seletor não pular de lugar.
    if (next === "custom") setCustomMonth(month);
    setPeriod(next);
  }

  return (
    <section className="rep">
      <h1>Relatórios</h1>
      <div className="rep-filters">
        <PeriodChips
          period={period}
          month={month}
          maxMonth={thisMonth}
          onPeriod={choosePeriod}
          onMonth={setCustomMonth}
        />
        <ChipGroup label="Dono">
          {OWNERS.map((o) => (
            <Chip key={o.label} selected={owner === o.value} onClick={() => setOwner(o.value)}>
              {o.label}
            </Chip>
          ))}
        </ChipGroup>
      </div>
      {report.isPending ? (
        <ReportSkeleton />
      ) : report.isError ? (
        <ErrorState message="Não deu para carregar o relatório." onRetry={() => void report.refetch()} />
      ) : (
        <ReportBody report={report.data} month={month} />
      )}
    </section>
  );
}
