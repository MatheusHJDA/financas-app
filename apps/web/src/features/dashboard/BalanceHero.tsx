import { ChevronDown, Wallet } from "lucide-react";
import { useId, useState } from "react";
import type { components } from "../../api/schema";
import { Card, Money, useHideValues } from "../../ui";
import { ACCOUNT_TYPE_LABEL, OWNER_LABEL } from "./format";

type Overview = components["schemas"]["Overview"];

/** Saldo atual do casal (`couple_total_cents`): não depende do mês. "Expandir" abre os três donos. */
export function BalanceHero({ overview }: { overview: Overview }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <Card title="Saldos" icon={Wallet} className="dash-hero">
      <p className="dash-hero__label">Total do casal</p>
      <p className="dash-hero__value">
        <Money cents={overview.couple_total_cents} />
      </p>
      <button
        type="button"
        className="dash-expand"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Recolher" : "Expandir"} <span className="visually-hidden">saldos por dono e faturas</span>
        <ChevronDown aria-hidden="true" size={18} strokeWidth={1.75} className={open ? "dash-expand__icon dash-expand__icon--up" : "dash-expand__icon"} />
      </button>

      <div id={panelId} className="dash-hero__more" hidden={!open}>
        {open ? <OwnerGroups overview={overview} /> : null}
      </div>
    </Card>
  );
}

function OwnerGroups({ overview }: { overview: Overview }) {
  const { hidden } = useHideValues();
  // Com o olho fechado a cor também não pode denunciar o sinal.
  const negClass = (cents: number) => (cents < 0 && !hidden ? "dash-neg" : undefined);
  return (
    <>
      {overview.balances_by_owner.map((group) => (
        <div key={group.owner} role="group" aria-label={`Saldos de ${OWNER_LABEL[group.owner]}`} className="dash-owner">
          <h3 className="dash-owner__title">{OWNER_LABEL[group.owner]}</h3>
          {group.accounts.length === 0 ? (
            <p className="muted dash-owner__empty">Nenhuma conta.</p>
          ) : (
            <ul className="dash-owner__list">
              {group.accounts.map((a) => (
                <li key={a.id} className="dash-owner__row">
                  <span className="dash-owner__name">
                    {a.name}
                    <span className="muted dash-small"> · {ACCOUNT_TYPE_LABEL[a.type]}</span>
                  </span>
                  <Money cents={a.current_balance_cents} className={negClass(a.current_balance_cents)} />
                </li>
              ))}
            </ul>
          )}
          <p className="dash-owner__total">
            <strong>Total de {OWNER_LABEL[group.owner]}</strong>
            <Money cents={group.total_cents} className={negClass(group.total_cents)} />
          </p>
        </div>
      ))}

      <div role="group" aria-label="Faturas abertas dos cartões" className="dash-owner">
        <h3 className="dash-owner__title">Faturas abertas</h3>
        {overview.open_card_invoices.length === 0 ? (
          <p className="muted dash-owner__empty">Nenhuma fatura aberta.</p>
        ) : (
          <ul className="dash-owner__list">
            {overview.open_card_invoices.map((inv) => (
              <li key={inv.account_id} className="dash-owner__row">
                <span className="dash-owner__name">{inv.account_name}</span>
                <Money cents={inv.open_amount_cents} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
