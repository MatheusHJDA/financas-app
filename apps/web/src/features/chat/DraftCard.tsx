import { useState, type ReactNode } from "react";
import { formatDate } from "./dates";
import { formatCents } from "./money";
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
        {low.has(key) ? <span className="badge badge--warn"> Confira</span> : null}
      </dd>
    </div>
  );

  const heading = `${KIND_LABEL[p.kind]}: ${p.description}`;

  return (
    <article className={`draft-card draft-card--${view.status}`} aria-label={heading}>
      <header className="draft-head">
        <p className={low.has("amount") ? "draft-amount draft-row--low" : "draft-amount"}>
          {formatCents(p.amount_cents)}
          {low.has("amount") ? <span className="badge badge--warn"> Confira</span> : null}
        </p>
        <p className="draft-confidence muted">Confiança: {Math.round(draft.confidence * 100)}%</p>
        {view.edited ? <span className="badge">Editado</span> : null}
      </header>

      {draft.duplicate_of_transaction_id != null ? (
        <p className="signal signal--warn" role="note">
          Já existe? Parece com o lançamento nº {draft.duplicate_of_transaction_id}.
        </p>
      ) : null}
      {draft.plan_rule_warning ? (
        <p className="signal signal--warn" role="note">
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
        <p className="field-error" role="alert">
          {view.error}
        </p>
      ) : null}

      {pending && !editing ? (
        <>
          {missing ? <p className="muted">{missing}</p> : null}
          <div className="draft-actions">
            <button
              type="button"
              className="btn btn--primary"
              aria-label={`Confirmar ${p.description}`}
              disabled={locked || missing !== null}
              onClick={() => onConfirm({ draft, edited: view.edited })}
            >
              Confirmar
            </button>
            <button
              type="button"
              className="btn"
              aria-label={`Editar ${p.description}`}
              disabled={locked}
              onClick={() => setEditing(true)}
            >
              Editar
            </button>
            <button
              type="button"
              className="btn"
              aria-label={`Descartar ${p.description}`}
              disabled={locked}
              onClick={() => onDiscard(draft)}
            >
              Descartar
            </button>
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
                <button
                  type="button"
                  className="btn"
                  aria-label={`Marcar como paga: ${p.description}`}
                  disabled={view.bill === "paying"}
                  onClick={() =>
                    onPayBill(draft.id, draft.suggested_bill_instance_id as number, view.transactionId as number)
                  }
                >
                  Marcar como paga
                </button>
                {view.billError ? (
                  <p className="field-error" role="alert">
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
