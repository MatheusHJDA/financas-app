import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Check, Pencil } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, Money } from "../../ui";
import { formatDate } from "./dates";
import { missingForConfirm, proposalToForm } from "./proposal";
import { TransactionForm } from "./TransactionForm";
import { KIND_LABEL, OWNER_LABEL, type Account, type Category, type Draft, type Owner, type Proposal } from "./types";
import type { ConfirmItem, DraftView } from "./useDraftController";

interface Props {
  draft: Draft;
  view: DraftView;
  accounts: Account[];
  categories: Category[];
  fallbackOwner: Owner;
  onConfirm: (item: ConfirmItem) => void;
  onDiscard: (draft: Draft) => void;
  onEdit: (id: number, edited: Proposal) => void;
  onPayBill: (draftId: number, billInstanceId: number, transactionId: number) => void;
}

const KIND_ICON = { income: ArrowDownLeft, expense: ArrowUpRight, transfer: ArrowLeftRight } as const;

/** Nomes de campo da IA (amount_cents, account_id…) -> chave da linha do cartão. */
function rowKey(field: string): string {
  return field.toLowerCase().replace(/_(cents|id|hint)$/, "");
}

export function DraftCard({
  draft,
  view,
  accounts,
  categories,
  fallbackOwner,
  onConfirm,
  onDiscard,
  onEdit,
  onPayBill,
}: Props) {
  const [editing, setEditing] = useState(false);
  const p = view.edited ?? draft.payload;
  const low = new Set(draft.low_confidence_fields.map(rowKey));
  const accountName = (id: number | null | undefined) =>
    id == null ? null : (accounts.find((a) => a.id === id)?.name ?? `Conta ${id}`);
  const category = p.category_id == null ? null : categories.find((c) => c.id === p.category_id);
  const missing = missingForConfirm(p);
  const pending = view.status === "pending";
  const locked = view.busy;

  const row = (key: string, label: string, value: ReactNode) => (
    <div className={low.has(key) ? "draft-row draft-row--low" : "draft-row"}>
      <dt>{label}</dt>
      <dd>
        {value}
        {low.has(key) ? <span className="chat-badge chat-badge--warn"> Confira</span> : null}
      </dd>
    </div>
  );

  const heading = `${KIND_LABEL[p.kind]}: ${p.description}`;
  const KindIcon = KIND_ICON[p.kind];

  return (
    <article className={`draft-card draft-card--${view.status}`} aria-label={heading}>
      <header className="draft-head">
        <span className={`draft-kind draft-kind--${p.kind}`} aria-hidden="true">
          <KindIcon size={20} strokeWidth={1.9} />
        </span>
        <div className="draft-head__text">
          <p className={low.has("amount") ? "draft-amount draft-row--low" : "draft-amount"}>
            <Money cents={p.amount_cents} />
            {low.has("amount") ? <span className="chat-badge chat-badge--warn"> Confira</span> : null}
          </p>
          <p className="draft-confidence">Confiança: {Math.round(draft.confidence * 100)}%</p>
        </div>
        {view.edited ? <span className="chat-badge">Editado</span> : null}
      </header>

      {draft.duplicate_of_transaction_id != null ? (
        <p className="chat-signal chat-signal--warn" role="note">
          Já existe? Parece com o lançamento nº {draft.duplicate_of_transaction_id}.
        </p>
      ) : null}
      {draft.plan_rule_warning ? (
        <p className="chat-signal chat-signal--warn" role="note">
          Regra do plano: {draft.plan_rule_warning}
        </p>
      ) : null}

      {editing ? (
        <TransactionForm
          initial={proposalToForm(p, fallbackOwner)}
          accounts={accounts}
          categories={categories}
          submitLabel="Salvar alterações"
          onSubmit={(edited) => {
            onEdit(draft.id, edited);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <dl className="draft-fields">
          {row("kind", "Tipo", KIND_LABEL[p.kind])}
          {row("date", "Data", formatDate(p.date))}
          {row("account", p.kind === "transfer" ? "Origem" : "Conta", accountName(p.account_id) ?? "Não definida")}
          {p.kind === "transfer"
            ? row("to_account", "Destino", accountName(p.to_account_id) ?? "Não definido")
            : row("category", "Categoria", category?.name ?? "Sem categoria")}
          {row("owner", "Dono", p.owner ? OWNER_LABEL[p.owner] : OWNER_LABEL[fallbackOwner])}
          {row("description", "Descrição", p.description)}
        </dl>
      )}

      {view.note ? <p className="muted">{view.note}</p> : null}
      {view.error ? (
        <p className="chat-field-error" role="alert">
          {view.error}
        </p>
      ) : null}

      {pending && !editing ? (
        <>
          {missing ? <p className="muted">{missing}</p> : null}
          <div className="draft-actions">
            <Button
              variant="primary"
              icon={Check}
              aria-label={`Confirmar ${p.description}`}
              disabled={locked || missing !== null}
              onClick={() => onConfirm({ draft, edited: view.edited })}
            >
              Confirmar
            </Button>
            <Button
              icon={Pencil}
              aria-label={`Editar ${p.description}`}
              disabled={locked}
              onClick={() => setEditing(true)}
            >
              Editar
            </Button>
            <Button
              variant="ghost"
              aria-label={`Descartar ${p.description}`}
              disabled={locked}
              onClick={() => onDiscard(draft)}
            >
              Descartar
            </Button>
          </div>
        </>
      ) : null}

      {view.status === "confirmed" ? (
        <div className="draft-final" role="status">
          <p className="draft-state draft-state--ok">✓ Confirmado</p>
          {draft.suggested_bill_instance_id != null && view.transactionId != null && p.kind === "expense" ? (
            view.bill === "paid" ? (
              <p className="draft-state draft-state--ok">✓ Conta a pagar marcada como paga</p>
            ) : (
              <div className="bill-offer">
                <p>Parece o pagamento de uma conta a pagar. Marcar como paga?</p>
                <Button
                  aria-label={`Marcar como paga: ${p.description}`}
                  disabled={view.bill === "paying"}
                  onClick={() =>
                    onPayBill(draft.id, draft.suggested_bill_instance_id as number, view.transactionId as number)
                  }
                >
                  Marcar como paga
                </Button>
                {view.billError ? (
                  <p className="chat-field-error" role="alert">
                    {view.billError}
                  </p>
                ) : null}
              </div>
            )
          ) : null}
        </div>
      ) : null}
      {view.status === "discarded" ? (
        <p className="draft-state draft-state--off" role="status">
          ✕ Descartado
        </p>
      ) : null}
    </article>
  );
}
