import { useId, useState, type FormEvent } from "react";
import { accountOptionLabel, OWNER_LABEL, OWNERS, type Account, type Category, type Owner, type Transaction } from "../accounts/shared";
import { centsToInput } from "../chat/money";
import { formToProposal, type FormErrors, type FormField, type FormValues } from "../chat/proposal";
import { KIND_LABEL, KINDS, type Proposal, type TxKind } from "../chat/types";

interface Props {
  tx: Transaction;
  accounts: Account[];
  categories: Category[];
  busy?: boolean;
  serverError?: string | null;
  onSubmit: (body: Proposal) => void;
  onCancel: () => void;
}

const idText = (id: number | null | undefined) => (id == null ? "" : String(id));

function txToForm(tx: Transaction): FormValues {
  return {
    kind: tx.kind,
    amount: centsToInput(tx.amount_cents),
    date: tx.date,
    accountId: idText(tx.account_id),
    toAccountId: idText(tx.to_account_id),
    categoryId: idText(tx.category_id),
    owner: tx.owner,
    description: tx.description,
  };
}

/** Edição de um lançamento. Valor em R$ ("1.234,56") vira centavos inteiros. */
export function TxEditForm({ tx, accounts, categories, busy = false, serverError = null, onSubmit, onCancel }: Props) {
  const uid = useId();
  const [values, setValues] = useState<FormValues>(() => txToForm(tx));
  const [errors, setErrors] = useState<FormErrors>({});

  const set = <K extends FormField>(field: K, value: FormValues[K]) => {
    setValues((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "kind") {
        const cat = categories.find((c) => String(c.id) === prev.categoryId);
        if (value === "transfer" || (cat && cat.kind !== value)) next.categoryId = "";
        if (value !== "transfer") next.toAccountId = "";
      }
      return next;
    });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const result = formToProposal(values);
    if ("errors" in result) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSubmit(result.proposal);
  };

  const id = (f: string) => `${uid}-${f}`;
  const err = (f: FormField) =>
    errors[f] ? (
      <p id={id(`${f}-err`)} className="u8-err" role="alert">
        {errors[f]}
      </p>
    ) : null;
  const a11y = (f: FormField) => (errors[f] ? { "aria-invalid": true, "aria-describedby": id(`${f}-err`) } : undefined);
  const shownCategories = categories.filter((c) => c.kind === values.kind);

  return (
    <form className="u8-form" onSubmit={submit} noValidate aria-label={`Editar lançamento ${tx.description}`}>
      <div className="u8-field">
        <label htmlFor={id("kind")}>Tipo</label>
        <select id={id("kind")} value={values.kind} onChange={(e) => set("kind", e.target.value as TxKind)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      <div className="u8-field">
        <label htmlFor={id("amount")}>Valor (R$)</label>
        <input
          id={id("amount")}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          value={values.amount}
          onChange={(e) => set("amount", e.target.value)}
          {...a11y("amount")}
        />
        {err("amount")}
      </div>

      <div className="u8-field">
        <label htmlFor={id("date")}>Data</label>
        <input id={id("date")} type="date" value={values.date} onChange={(e) => set("date", e.target.value)} {...a11y("date")} />
        {err("date")}
      </div>

      <div className="u8-field">
        <label htmlFor={id("account")}>{values.kind === "transfer" ? "Conta de origem" : "Conta"}</label>
        <select id={id("account")} value={values.accountId} onChange={(e) => set("accountId", e.target.value)} {...a11y("accountId")}>
          <option value="">Escolha a conta</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {accountOptionLabel(a)}
            </option>
          ))}
        </select>
        {err("accountId")}
      </div>

      {values.kind === "transfer" ? (
        <div className="u8-field">
          <label htmlFor={id("to")}>Conta de destino</label>
          <select id={id("to")} value={values.toAccountId} onChange={(e) => set("toAccountId", e.target.value)} {...a11y("toAccountId")}>
            <option value="">Escolha a conta de destino</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {accountOptionLabel(a)}
              </option>
            ))}
          </select>
          {err("toAccountId")}
        </div>
      ) : (
        <div className="u8-field">
          <label htmlFor={id("category")}>Categoria</label>
          <select id={id("category")} value={values.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
            <option value="">Sem categoria</option>
            {shownCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="u8-field">
        <label htmlFor={id("owner")}>Dono</label>
        <select id={id("owner")} value={values.owner} onChange={(e) => set("owner", e.target.value as Owner)} {...a11y("owner")}>
          {OWNERS.map((o) => (
            <option key={o} value={o}>
              {OWNER_LABEL[o]}
            </option>
          ))}
        </select>
        {err("owner")}
      </div>

      <div className="u8-field">
        <label htmlFor={id("description")}>Descrição</label>
        <input
          id={id("description")}
          autoComplete="off"
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
          {...a11y("description")}
        />
        {err("description")}
      </div>

      {serverError ? (
        <p className="u8-err" role="alert">
          {serverError}
        </p>
      ) : null}

      <div className="u8-actions">
        <button type="submit" className="u8-btn u8-btn--primary" disabled={busy}>
          Salvar lançamento
        </button>
        <button type="button" className="u8-btn" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
