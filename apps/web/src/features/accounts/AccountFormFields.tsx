import { useId, useState, type FormEvent } from "react";
import {
  formToAccountBody,
  type AccountBody,
  type AccountFormErrors,
  type AccountFormValues,
} from "./accountForm";
import { ACCOUNT_TYPE_LABEL, ACCOUNT_TYPES, OWNER_LABEL, OWNERS, type AccountType, type Owner } from "./shared";

interface Props {
  initial: AccountFormValues;
  submitLabel: string;
  busy?: boolean;
  serverError?: string | null;
  /** Edição: mostra a opção "Conta ativa". */
  editing?: boolean;
  onSubmit: (body: AccountBody) => void;
  onCancel: () => void;
}

export function AccountForm({ initial, submitLabel, busy = false, serverError = null, editing = false, onSubmit, onCancel }: Props) {
  const uid = useId();
  const [values, setValues] = useState<AccountFormValues>(initial);
  const [errors, setErrors] = useState<AccountFormErrors>({});

  const set = <K extends keyof AccountFormValues>(field: K, value: AccountFormValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const result = formToAccountBody(values);
    if ("errors" in result) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSubmit(result.body);
  };

  const id = (f: string) => `${uid}-${f}`;
  const err = (f: keyof AccountFormValues) =>
    errors[f] ? (
      <p id={id(`${f}-err`)} className="u8-err" role="alert">
        {errors[f]}
      </p>
    ) : null;
  const a11y = (f: keyof AccountFormValues) =>
    errors[f] ? { "aria-invalid": true, "aria-describedby": id(`${f}-err`) } : undefined;

  const isCard = values.type === "credit_card";
  const isLoan = values.type === "loan";

  return (
    <form className="u8-form" onSubmit={submit} noValidate aria-label={editing ? "Editar conta" : "Nova conta"}>
      <div className="u8-field">
        <label htmlFor={id("type")}>Tipo da conta</label>
        <select id={id("type")} value={values.type} onChange={(e) => set("type", e.target.value as AccountType)}>
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {ACCOUNT_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      {isLoan ? (
        <p className="u8-note">
          Empréstimo: o saldo é <strong>negativo</strong> (o que você deve), por exemplo -5.000,00. Deixe o empréstimo em um
          lugar só: ou como conta do tipo empréstimo, ou como dívida em Metas. Nos dois lugares ele conta duas vezes.
        </p>
      ) : null}

      <div className="u8-field">
        <label htmlFor={id("name")}>Nome da conta</label>
        <input
          id={id("name")}
          autoComplete="off"
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          {...a11y("name")}
        />
        {err("name")}
      </div>

      <div className="u8-field">
        <label htmlFor={id("owner")}>Dono</label>
        <select id={id("owner")} value={values.owner} onChange={(e) => set("owner", e.target.value as Owner)}>
          {OWNERS.map((o) => (
            <option key={o} value={o}>
              {OWNER_LABEL[o]}
            </option>
          ))}
        </select>
      </div>

      <div className="u8-field">
        <label htmlFor={id("balance")}>{isLoan ? "Saldo inicial (negativo, R$)" : "Saldo inicial (R$)"}</label>
        <input
          id={id("balance")}
          inputMode="decimal"
          autoComplete="off"
          placeholder={isLoan ? "-5.000,00" : "0,00"}
          value={values.balance}
          onChange={(e) => set("balance", e.target.value)}
          {...a11y("balance")}
        />
        {err("balance")}
      </div>

      <div className="u8-field">
        <label htmlFor={id("date")}>Data do saldo inicial</label>
        <input
          id={id("date")}
          type="date"
          value={values.balanceDate}
          onChange={(e) => set("balanceDate", e.target.value)}
          {...a11y("balanceDate")}
        />
        {err("balanceDate")}
      </div>

      <div className="u8-field">
        <label htmlFor={id("institution")}>Banco ou instituição (opcional)</label>
        <input
          id={id("institution")}
          autoComplete="off"
          value={values.institution}
          onChange={(e) => set("institution", e.target.value)}
        />
      </div>

      {isCard ? (
        <>
          <div className="u8-field">
            <label htmlFor={id("last4")}>Final do cartão (opcional)</label>
            <input
              id={id("last4")}
              inputMode="numeric"
              maxLength={4}
              autoComplete="off"
              value={values.last4}
              onChange={(e) => set("last4", e.target.value)}
              {...a11y("last4")}
            />
            {err("last4")}
          </div>
          <div className="u8-field">
            <label htmlFor={id("closing")}>Dia do fechamento da fatura (opcional)</label>
            <input
              id={id("closing")}
              inputMode="numeric"
              autoComplete="off"
              value={values.closingDay}
              onChange={(e) => set("closingDay", e.target.value)}
              {...a11y("closingDay")}
            />
            {err("closingDay")}
          </div>
          <div className="u8-field">
            <label htmlFor={id("due")}>Dia do vencimento da fatura (opcional)</label>
            <input
              id={id("due")}
              inputMode="numeric"
              autoComplete="off"
              value={values.dueDay}
              onChange={(e) => set("dueDay", e.target.value)}
              {...a11y("dueDay")}
            />
            {err("dueDay")}
          </div>
        </>
      ) : null}

      {editing ? (
        <label className="u8-check">
          <input type="checkbox" checked={values.active} onChange={(e) => set("active", e.target.checked)} />
          Conta ativa
        </label>
      ) : null}

      {serverError ? (
        <p className="u8-err" role="alert">
          {serverError}
        </p>
      ) : null}

      <div className="u8-actions">
        <button type="submit" className="u8-btn u8-btn--primary" disabled={busy}>
          {submitLabel}
        </button>
        <button type="button" className="u8-btn" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
