import { formatCents } from "../chat/money";
import type { PlanMonth } from "./planApi";
import { monthLongLabel } from "./planMath";

// Mês a mês em blocos empilhados (lê bem em 360 px; tabela larga não cabe).
export function MonthList({ months }: { months: PlanMonth[] }) {
  return (
    <section aria-labelledby="plan-meses" className="plan-months-section">
      <h2 id="plan-meses">Mês a mês</h2>
      <ol className="plan-months">
        {months.map((m) => (
          <li key={m.month} className="card plan-month">
            <h3>{monthLongLabel(m.month)}</h3>
            <dl>
              <div>
                <dt>Entradas</dt>
                <dd>{formatCents(m.income_cents)}</dd>
              </div>
              <div>
                <dt>Saídas</dt>
                <dd>{formatCents(m.expense_cents)}</dd>
              </div>
              <div>
                <dt>Amortização</dt>
                <dd>{formatCents(m.amortization_cents)}</dd>
              </div>
              <div>
                <dt>Saldo devedor</dt>
                <dd>{formatCents(m.debt_balance_cents)}</dd>
              </div>
              <div>
                <dt>Caixa</dt>
                <dd>{formatCents(m.reserve_cents)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
    </section>
  );
}
