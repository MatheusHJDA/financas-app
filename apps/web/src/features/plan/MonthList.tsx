import { Money } from "../../ui";
import type { PlanMonth } from "./planApi";
import { monthLongLabel } from "./planMath";

// Mês a mês em cartões empilhados (lê bem em 360 px; tabela larga não cabe). No computador, em grade.
export function MonthList({ months }: { months: PlanMonth[] }) {
  return (
    <section aria-labelledby="plan-meses" className="plan-months-section">
      <h2 id="plan-meses">Mês a mês</h2>
      <ol className="plan-months">
        {months.map((m) => (
          <li key={m.month} className="ui-card plan-month">
            <h3>{monthLongLabel(m.month)}</h3>
            <dl>
              <div>
                <dt>Entradas</dt>
                <dd>
                  <Money cents={m.income_cents} />
                </dd>
              </div>
              <div>
                <dt>Saídas</dt>
                <dd>
                  <Money cents={m.expense_cents} />
                </dd>
              </div>
              <div>
                <dt>Amortização</dt>
                <dd>
                  <Money cents={m.amortization_cents} />
                </dd>
              </div>
              <div>
                <dt>Saldo devedor</dt>
                <dd>
                  <Money cents={m.debt_balance_cents} />
                </dd>
              </div>
              <div>
                <dt>Caixa</dt>
                <dd>
                  <Money cents={m.reserve_cents} />
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
    </section>
  );
}
