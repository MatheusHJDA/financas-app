import { PieChart } from "lucide-react";
import type { CSSProperties } from "react";
import { Card, ListItem, Money } from "../../ui";
import { categoryColor } from "../../ui/charts/palette";
import type { MonthReport } from "./api";
import { formatShare } from "./formatShare";
import { LazyDonutChart } from "./LazyCharts";

type Props = { categories: MonthReport["by_category"]; totalCents: number };

/** Rosca das despesas por categoria + lista com valor e percentual (vem pronto da API, em pontos-base). */
export function CategoryBreakdown({ categories, totalCents }: Props) {
  const data = categories.map((c) => ({
    key: c.category_id === null ? "sem-categoria" : String(c.category_id),
    name: c.name,
    cents: c.total_cents,
  }));
  return (
    <Card title="Gastos por categoria" icon={PieChart} className="rep-card">
      <LazyDonutChart
        label="Gastos por categoria"
        data={data}
        legend={false}
        centerLabel={
          <span className="rep-donut-center">
            <span className="rep-donut-center__label">Saídas</span>
            <Money cents={totalCents} />
          </span>
        }
      />
      <ul className="rep-cats" aria-label="Categorias">
        {categories.map((c, i) => (
          <li key={data[i].key} className="rep-cats__item">
            <ListItem
              leading={
                <span
                  className="rep-cats__dot"
                  aria-hidden="true"
                  style={{ "--dot": categoryColor(i) } as CSSProperties}
                />
              }
              title={c.name}
              subtitle={formatShare(c.share_bp)}
              trailing={<Money cents={c.total_cents} />}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}
