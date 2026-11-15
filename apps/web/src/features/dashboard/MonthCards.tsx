import { ArrowDownCircle, ArrowUpCircle, CheckCircle2, Clock } from "lucide-react";
import { Money, StatCard } from "../../ui";
import type { MonthReport } from "../reports/api";
import { plural } from "./format";

/** Quatro cartões do mês: receitas, despesas, contas pagas e a pagar (tudo vindo de `/reports/month`). */
export function MonthCards({ report }: { report: MonthReport }) {
  const { bills } = report;
  return (
    <div className="dash-stats">
      <StatCard label="Receitas" icon={ArrowUpCircle} tone="income" cents={report.income_cents} />
      <StatCard label="Despesas" icon={ArrowDownCircle} tone="expense" cents={report.expense_cents} />
      <StatCard
        label="Contas pagas"
        icon={CheckCircle2}
        tone="info"
        value={`${bills.paid_count} de ${bills.total_count}`}
        hint={<Money cents={bills.paid_cents} />}
      />
      <StatCard
        label="A pagar"
        icon={Clock}
        tone="warning"
        cents={bills.open_cents}
        hint={plural(bills.open_count, "conta", "contas")}
      />
    </div>
  );
}
