import { Equal, TrendingDown, TrendingUp } from "lucide-react";
import { Money } from "../../ui";
import type { MonthReport } from "../reports/api";

/** "Você gastou R$ X a mais/menos que no mês anterior". Some quando o mês anterior não teve despesa. */
export function MonthInsight({ report }: { report: MonthReport }) {
  if (report.previous.expense_cents === 0) return null;
  const delta = report.expense_delta_cents;

  if (delta === 0) {
    return (
      <p className="dash-insight dash-insight--same">
        <Equal aria-hidden="true" size={18} strokeWidth={1.75} />
        Você gastou o mesmo que no mês anterior
      </p>
    );
  }
  const more = delta > 0;
  const Icon = more ? TrendingUp : TrendingDown;
  return (
    <p className={`dash-insight ${more ? "dash-insight--more" : "dash-insight--less"}`}>
      <Icon aria-hidden="true" size={18} strokeWidth={1.75} />
      Você gastou <Money cents={Math.abs(delta)} /> {more ? "a mais" : "a menos"} que no mês anterior
    </p>
  );
}
