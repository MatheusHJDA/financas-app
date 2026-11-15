import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Pencil, Trash2 } from "lucide-react";
import type { Me } from "../../auth/AuthProvider";
import { IconButton, ListItem, Money } from "../../ui";
import { canWrite, OWNER_LABEL, type Account, type Category, type Transaction } from "../accounts/shared";
import { KIND_LABEL, type TxKind } from "../chat/types";
import { dayLabel } from "./filters";

interface Props {
  items: Transaction[];
  accounts: Account[];
  categories: Category[];
  me: Me | null | undefined;
  /** Hoje em São Paulo ("aaaa-mm-dd"), para "Hoje"/"Ontem". */
  today: string;
  onEdit: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
}

const KIND_ICON = { expense: ArrowUpRight, income: ArrowDownLeft, transfer: ArrowLeftRight } as const;

/** Lançamentos seguidos com a mesma data viram um grupo (a API já devolve do mais novo para o mais antigo). */
function groupByDay(items: Transaction[]): { date: string; items: Transaction[] }[] {
  const groups: { date: string; items: Transaction[] }[] = [];
  for (const tx of items) {
    const last = groups.at(-1);
    if (last && last.date === tx.date) last.items.push(tx);
    else groups.push({ date: tx.date, items: [tx] });
  }
  return groups;
}

function KindBubble({ kind }: { kind: TxKind }) {
  const Icon = KIND_ICON[kind];
  return (
    <span aria-hidden="true" className={`tx-kind tx-kind--${kind}`}>
      <Icon size={20} strokeWidth={1.9} />
    </span>
  );
}

export function TransactionList({ items, accounts, categories, me, today, onEdit, onDelete }: Props) {
  const accountName = (id: number | null | undefined) => accounts.find((a) => a.id === id)?.name ?? "";
  const categoryName = (id: number | null | undefined) => categories.find((c) => c.id === id)?.name ?? "";

  return (
    <div className="tx-days">
      {groupByDay(items).map((group) => (
        <div key={group.date} className="tx-day">
            <h3 className="tx-day__title">{dayLabel(group.date, today)}</h3>
            <ul className="tx-day__list">
              {group.items.map((tx) => {
                const route =
                  tx.kind === "transfer"
                    ? `${accountName(tx.account_id)} → ${accountName(tx.to_account_id)}`
                    : accountName(tx.account_id);
                const subtitle = [KIND_LABEL[tx.kind], route, categoryName(tx.category_id), OWNER_LABEL[tx.owner]]
                  .filter(Boolean)
                  .join(" · ");
                const cents = tx.kind === "expense" ? -tx.amount_cents : tx.amount_cents;
                return (
                  <li key={tx.id} className="tx-row">
                    <ListItem
                      leading={<KindBubble kind={tx.kind} />}
                      title={tx.description}
                      subtitle={subtitle}
                      trailing={<Money cents={cents} signed={tx.kind !== "transfer"} />}
                    />
                    {canWrite(me, tx.owner) ? (
                      <div className="tx-row__actions">
                        <IconButton icon={Pencil} label={`Editar ${tx.description}`} onClick={() => onEdit(tx)} />
                        <IconButton
                          icon={Trash2}
                          label={`Excluir ${tx.description}`}
                          className="tx-icon-danger"
                          onClick={() => onDelete(tx)}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
        </div>
      ))}
    </div>
  );
}
