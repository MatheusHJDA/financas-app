import { useId, useState, type FormEvent } from "react";
import { formToProposal, type FormErrors, type FormField, type FormValues } from "./proposal";
import { KIND_LABEL, KINDS, OWNER_LABEL, OWNERS, type Account, type Category, type Proposal, type TxKind } from "./types";

interface Props {
  initial: FormValues;
  accounts: Account[];
  categories: Category[];
  submitLabel: string;
  busy?: boolean;
  /** Erro vindo do servidor (ex.: 403/422), mostrado acima dos botões. */
  serverError?: string | null;
  onSubmit: (proposal: Proposal) => void;
  onCancel?: () => void;
}

const accountLabel = (a: Account) => `${a.name} (${OWNER_LABEL[a.owner]})`;

/** Formulário único para Editar (cartão) e Lançar à mão. Valor em R$ vira centavos inteiros. */
export function TransactionForm({
  initial,
  accounts,
  categories,
  submitLabel,
  busy = false,
  serverError = null,
  onSubmit,
  onCancel,
}: Props) {
  const uid = useId();
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<FormErrors>({});

  const set = <K extends FormField>(field: K, value: FormValues[K]) => {
    setValues((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "kind") {
        // categoria de outro tipo não vale mais
        const kind = value as TxKind;
        const cat = categories.find((c) => String(c.id) === prev.categoryId);
        if (kind === "transfer" || (cat && cat.kind !== kind)) next.categoryId = "";
        if (kind !== "transfer") next.toAccountId = "";
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
      <span id={id(`${f}-err`)} className="field-error" role="alert">
        {errors[f]}
      </span>
    ) : null;
  const a11y = (f: FormField) =>
    errors[f] ? { "aria-invalid": true, "aria-describedby": id(`${f}-err`) } : undefined;

  const shownCategories = categories.filter((c) => c.kind === values.kind);

  return (
    <form className="tx-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={id("kind")}>Tipo</label>
        <select id={id("kind")} value={values.kind} onChange={(e) => set("kind", e.target.value as TxKind)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
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

      <div className="field">
        <label htmlFor={id("date")}>Data</label>
        <input
          id={id("date")}
          type="date"
          value={values.date}
          onChange={(e) => set("date", e.target.value)}
          {...a11y("date")}
        />
        {err("date")}
      </div>

      <div className="field">
        <label htmlFor={id("account")}>{values.kind === "transfer" ? "Conta de origem" : "Conta"}</label>
        <select
          id={id("account")}
          value={values.accountId}
          onChange={(e) => set("accountId", e.target.value)}
          {...a11y("accountId")}
        >
          <option value="">Escolha a conta</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {accountLabel(a)}
            </option>
          ))}
        </select>
        {err("accountId")}
      </div>

      {values.kind === "transfer" ? (
        <div className="field">
          <label htmlFor={id("to")}>Conta de destino</label>
          <select
            id={id("to")}
            value={values.toAccountId}
            onChange={(e) => set("toAccountId", e.target.value)}
            {...a11y("toAccountId")}
          >
            <option value="">Escolha a conta de destino</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {accountLabel(a)}
              </option>
            ))}
          </select>
          {err("toAccountId")}
        </div>
      ) : (
        <div className="field">
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

      <div className="field">
        <label htmlFor={id("owner")}>Dono</label>
        <select
          id={id("owner")}
          value={values.owner}
          onChange={(e) => set("owner", e.target.value)}
          {...a11y("owner")}
        >
          {OWNERS.map((o) => (
            <option key={o} value={o}>
              {OWNER_LABEL[o]}
            </option>
          ))}
        </select>
        {err("owner")}
      </div>

      <div className="field">
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
        <p className="field-error" role="alert">
          {serverError}
        </p>
      ) : null}

      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {submitLabel}
        </button>
        {onCancel ? (
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
        ) : null}
      </div>
    </form>
  );
}
