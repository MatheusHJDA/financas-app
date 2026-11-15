import { BarChart3 } from "lucide-react";
import { Card } from "../../ui";
import { BarChart } from "../../ui/charts";
import type { PlanMonth } from "./planApi";
import { monthLabel } from "./planMath";

interface Props {
  months: PlanMonth[];
  payoffMonth: string | null;
}

/** Saldo devedor mês a mês, uma barra por mês até a quitação (ou todos os meses se não quita). Valores vêm da API. */
export function PlanChart({ months, payoffMonth }: Props) {
  // Datas ISO "AAAA-MM-01" comparam certo como texto.
  const shown = payoffMonth ? months.filter((m) => m.month <= payoffMonth) : months;
  return (
    <Card title="Saldo devedor mês a mês" icon={BarChart3} className="plan-chart">
      <BarChart
        label="Saldo devedor por mês"
        data={shown.map((m) => ({
          key: m.month,
          label: monthLabel(m.month),
          values: [{ name: "Saldo devedor", cents: m.debt_balance_cents, tone: "expense" }],
        }))}
      />
    </Card>
  );
}
