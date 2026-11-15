import { CalendarClock } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { components } from "../../api/schema";
import { Avatar, Card, ListItem, Money } from "../../ui";
import { daysBetween, formatDate, OWNER_LABEL, todayIso } from "./format";

type BillInstance = components["schemas"]["BillInstance"];

function dueLabel(due: string, today: string): string {
  const days = daysBetween(today, due);
  if (days <= 0) return "Vence hoje";
  if (days === 1) return "Vence amanhã";
  return `Vence em ${days} dias`;
}

/** Contas fixas atrasadas e das próximas duas semanas (sempre o "agora", não o mês escolhido). */
export function UpcomingBills({ upcoming, overdue }: { upcoming: BillInstance[]; overdue: BillInstance[] }) {
  const today = todayIso();
  const empty = upcoming.length === 0 && overdue.length === 0;

  return (
    <Card
      title="Contas a pagar"
      icon={CalendarClock}
      className="dash-bills"
      action={
        <Link to="/contas-fixas" className="dash-link" aria-label="Ver contas fixas">
          Ver tudo
        </Link>
      }
    >
      {empty ? (
        <p className="muted dash-empty">Nenhuma conta a pagar nos próximos dias.</p>
      ) : (
        <div className="dash-list">
          {overdue.map((b) => (
            <BillRow key={b.id} bill={b} badge={<span className="dash-badge dash-badge--late">Atrasada</span>} />
          ))}
          {upcoming.map((b) => (
            <BillRow key={b.id} bill={b} badge={<span className="dash-badge dash-badge--soon">{dueLabel(b.due_date, today)}</span>} />
          ))}
        </div>
      )}
    </Card>
  );
}

function BillRow({ bill, badge }: { bill: BillInstance; badge: ReactNode }) {
  const name = bill.name ?? "Conta";
  return (
    <ListItem
      leading={<Avatar name={name} tone="warning" />}
      title={name}
      subtitle={`${bill.owner ? `${OWNER_LABEL[bill.owner]} · ` : ""}${formatDate(bill.due_date)}`}
      trailing={
        <span className="dash-bill-trail">
          <Money cents={bill.amount_cents} />
          {badge}
        </span>
      }
    />
  );
}
