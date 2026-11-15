import { LineChart as LineIcon, PieChart as PieIcon } from "lucide-react";
import { Card, Money, Skeleton, SkeletonGroup } from "../../ui";
import { categoryColor, DonutChart, LineChart } from "../../ui/charts";
import type { MonthReport } from "../reports/api";
import { formatShare } from "./format";

const TOP = 5;

type Slice = { key: string; name: string; cents: number; bp: number };

/** 5 maiores categorias + "Outras". Só soma inteiros que a API já agregou (centavos e pontos-base). */
function topSlices(byCategory: MonthReport["by_category"]): Slice[] {
  const head: Slice[] = byCategory.slice(0, TOP).map((c) => ({
    key: String(c.category_id ?? "none"),
    name: c.name,
    cents: c.total_cents,
    bp: c.share_bp,
  }));
  const rest = byCategory.slice(TOP);
  if (rest.length === 0) return head;
  return [
    ...head,
    {
      key: "others",
      name: "Outras",
      cents: rest.reduce((sum, c) => sum + c.total_cents, 0),
      bp: rest.reduce((sum, c) => sum + c.share_bp, 0),
    },
  ];
}

function ChartSkeleton({ label }: { label: string }) {
  return (
    <div className="ui-card">
      <SkeletonGroup label={label}>
        <Skeleton width="40%" />
        <Skeleton variant="block" height="220px" />
      </SkeletonGroup>
    </div>
  );
}

/** Gráficos do computador (≥ 1024px): ritmo de gasto (este mês × anterior) e top 5 categorias. */
export function MonthCharts({ report, loading }: { report?: MonthReport; loading: boolean }) {
  if (loading) {
    return (
      <>
        <div className="dash-pace">
          <ChartSkeleton label="Carregando ritmo de gasto" />
        </div>
        <ChartSkeleton label="Carregando categorias" />
      </>
    );
  }
  if (!report) return null;

  const { current, previous } = report.daily_cumulative_expense;
  const slices = topSlices(report.by_category);

  return (
    <>
      <Card title="Ritmo de gasto" icon={LineIcon} className="dash-pace">
        <LineChart
          label="Ritmo de gasto acumulado"
          xLabel={(x) => `Dia ${x}`}
          series={[
            { name: "Este mês", tone: "expense", points: current.map((p) => ({ x: p.day, cents: p.cents })) },
            {
              name: "Mês anterior",
              tone: "neutral",
              dashed: true,
              points: previous.map((p) => ({ x: p.day, cents: p.cents })),
            },
          ]}
        />
      </Card>
      <Card title="Top 5 categorias" icon={PieIcon} className="dash-top">
        <DonutChart
          label="Despesas por categoria"
          legend={false}
          data={slices.map((s) => ({ key: s.key, name: s.name, cents: s.cents }))}
          centerLabel={
            <span className="dash-donut-center">
              <span className="muted dash-small">Despesas</span>
              <Money cents={report.expense_cents} />
            </span>
          }
        />
        {/* Lista visual com cor e percentual; a tabela acessível do gráfico já diz os valores. */}
        <ul className="dash-top__list" aria-hidden="true">
          {slices.map((s, i) => (
            <li key={s.key} className="dash-top__row">
              <span className="dash-top__dot" style={{ background: categoryColor(i) }} />
              <span className="dash-top__name">{s.name}</span>
              <span className="dash-top__pct">{formatShare(s.bp)}</span>
              <Money cents={s.cents} />
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
