// Saldos da tela Contas (versão nova de overview/BalancesSection, que fica para a tela Início até a integração).
// Todos os totais vêm da API (/overview); aqui só se exibe.
import { CreditCard, Landmark, Wallet } from "lucide-react";
import type { components } from "../../api/schema";
import { Avatar, Card, EmptyState, ListItem, Money, StatCard, useHideValues } from "../../ui";
import { formatDate } from "../chat/dates";
import type { Owner } from "./shared";
import "./accounts.css";

export type Overview = components["schemas"]["Overview"];

/** Total de um dono segundo a API; `null` se ainda não veio (nunca soma no front). */
export function ownerTotalCents(overview: Overview | undefined, owner: Owner): number | null {
  return overview?.balances_by_owner.find((g) => g.owner === owner)?.total_cents ?? null;
}

/** "Total do casal": soma dos saldos de todas as contas agora. */
export function CoupleTotal({ overview }: { overview: Overview }) {
  const { hidden } = useHideValues();
  return (
    <StatCard
      label="Total do casal"
      icon={Wallet}
      // Com o olho fechado o tom não pode denunciar o sinal: fica neutro.
      tone={hidden ? "info" : overview.couple_total_cents < 0 ? "expense" : "income"}
      cents={overview.couple_total_cents}
      hint="Soma dos saldos de todas as contas, agora"
    />
  );
}

/** Faturas abertas dos cartões e saldo devedor das dívidas. */
export function InvoicesAndDebts({ overview }: { overview: Overview }) {
  return (
    <>
      <div role="group" aria-label="Faturas abertas dos cartões">
        <Card title="Faturas abertas" icon={CreditCard}>
          {overview.open_card_invoices.length === 0 ? (
            <EmptyState title="Nenhuma fatura aberta" />
          ) : (
            <ul className="acc-list">
              {overview.open_card_invoices.map((inv) => (
                <li key={inv.account_id}>
                  <ListItem
                    leading={<Avatar name={inv.account_name} tone="expense" />}
                    title={inv.account_name}
                    subtitle={inv.due_date ? `vence em ${formatDate(inv.due_date)}` : undefined}
                    trailing={<Money cents={inv.open_amount_cents} />}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card>
        <ListItem
          leading={
            <span aria-hidden="true" className="acc-icon">
              <Landmark size={20} strokeWidth={1.75} />
            </span>
          }
          title="Saldo devedor das dívidas"
          trailing={<Money cents={overview.debts_balance_cents} />}
        />
      </Card>
    </>
  );
}
