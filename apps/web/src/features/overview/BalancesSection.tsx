import type { components } from "../../api/schema";
import { ACCOUNT_TYPE_LABEL, OWNER_LABEL } from "../accounts/shared";
import { formatDate } from "../chat/dates";
import { formatCents } from "../chat/money";
import "../accounts/ui.css";

type Overview = components["schemas"]["Overview"];

const sign = (cents: number) => (cents < 0 ? "u8-amount u8-neg" : "u8-amount");

/** Saldos por conta (agrupados por dono), total do casal, faturas abertas e saldo devedor das dívidas. */
export function BalancesSection({ overview }: { overview: Overview }) {
  return (
    <section className="u8-section" aria-labelledby="balances-title">
      <h2 id="balances-title">Saldos</h2>

      <div className="u8-card">
        <p className="muted" style={{ margin: 0 }}>
          Total do casal
        </p>
        <p className={`u8-big ${overview.couple_total_cents < 0 ? "u8-neg" : ""}`} style={{ margin: 0 }}>
          {formatCents(overview.couple_total_cents)}
        </p>
      </div>

      {overview.balances_by_owner.map((group) => (
        <div key={group.owner} className="u8-card" role="group" aria-label={`Saldos de ${OWNER_LABEL[group.owner]}`} style={{ marginTop: "var(--space-3)" }}>
          <h3>{OWNER_LABEL[group.owner]}</h3>
          {group.accounts.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Nenhuma conta.
            </p>
          ) : (
            <ul className="u8-list">
              {group.accounts.map((a) => (
                <li key={a.id} className="u8-row">
                  <span className="u8-grow">
                    {a.name}
                    <span className="muted u8-small"> · {ACCOUNT_TYPE_LABEL[a.type]}</span>
                  </span>
                  <span className={sign(a.current_balance_cents)}>{formatCents(a.current_balance_cents)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="u8-row u8-total" style={{ margin: "var(--space-2) 0 0" }}>
            <strong>Total de {OWNER_LABEL[group.owner]}</strong>
            <span className={sign(group.total_cents)}>{formatCents(group.total_cents)}</span>
          </p>
        </div>
      ))}

      <div className="u8-card" role="group" aria-label="Faturas abertas dos cartões" style={{ marginTop: "var(--space-3)" }}>
        <h3>Faturas abertas</h3>
        {overview.open_card_invoices.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nenhuma fatura aberta.
          </p>
        ) : (
          <ul className="u8-list">
            {overview.open_card_invoices.map((inv) => (
              <li key={inv.account_id} className="u8-row">
                <span className="u8-grow">
                  {inv.account_name}
                  {inv.due_date ? <span className="muted u8-small"> · vence em {formatDate(inv.due_date)}</span> : null}
                </span>
                <span className="u8-amount">{formatCents(inv.open_amount_cents)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="u8-card" style={{ marginTop: "var(--space-3)" }}>
        <p className="u8-row" style={{ margin: 0 }}>
          <strong>Saldo devedor das dívidas</strong>
          <span className="u8-amount">{formatCents(overview.debts_balance_cents)}</span>
        </p>
      </div>
    </section>
  );
}
