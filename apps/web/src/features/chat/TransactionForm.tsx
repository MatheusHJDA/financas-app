import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CalendarDays } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Button, Chip, ChipGroup } from "../../ui";
import { todayIso, yesterdayIso } from "./dates";
import { formToProposal, type FormErrors, type FormField, type FormValues } from "./proposal";
import { Segmented } from "./Segmented";
import { KIND_LABEL, KINDS, OWNER_LABEL, OWNERS, type Account, type Category, type Proposal, type TxKind } from "./types";

interface Props {
  initial: FormValues;
  accounts: Account[];
  categories: Category[];
  submitLabel: string;
  /** "card": compacto, dentro do cartão de rascunho. "sheet": Lançar à mão (cabeçalho colorido, valor grande). */
  variant?: "card" | "sheet";
  busy?: boolean;
  /** Erro vindo do servidor (ex.: 403/422), mostrado acima dos botões. */
  serverError?: string | null;
  onSubmit: (proposal: Proposal) => void;
  onCancel?: () => void;
}

const accountLabel = (a: Account) => `${a.name} (${OWNER_LABEL[a.owner]})`;

const KIND_TONE: Record<TxKind, "income" | "expense" | "info"> = {
  income: "income",
  expense: "expense",
  transfer: "info",
};
const KIND_ICON = { income: ArrowDownLeft, expense: ArrowUpRight, transfer: ArrowLeftRight } as const;
// Ordem do seletor: Receita, Despesa, Transferência
const SHEET_KINDS: TxKind[] = ["income", "expense", "transfer"];

/** Formulário único para Editar (cartão) e Lançar à mão. Valor em R$ vira centavos inteiros. */
export function TransactionForm({
  initial,
  accounts,
  categories,
  submitLabel,
  variant = "card",
  busy = false,
  serverError = null,
  onSubmit,
  onCancel,
}: Props) {
  const uid = useId();
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [pickDate, setPickDate] = useState(false);
  const sheet = variant === "sheet";

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
      <span id={id(`${f}-err`)} className="chat-field-error" role="alert">
        {errors[f]}
      </span>
    ) : null;
  const a11y = (f: FormField) =>
    errors[f] ? { "aria-invalid": true, "aria-describedby": id(`${f}-err`) } : undefined;

  const shownCategories = categories.filter((c) => c.kind === values.kind);

  const kindField = sheet ? null : (
    <div className="chat-field">
      <label htmlFor={id("kind")}>Tipo</label>
      <select
        id={id("kind")}
        className="chat-control"
        value={values.kind}
        onChange={(e) => set("kind", e.target.value as TxKind)}
      >
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {KIND_LABEL[k]}
          </option>
        ))}
      </select>
    </div>
  );

  const amountField = (
    <div className={sheet ? "tx-hero__amount" : "chat-field"}>
      <label htmlFor={id("amount")}>Valor (R$)</label>
      <input
        id={id("amount")}
        className={sheet ? "tx-amount" : "chat-control"}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0,00"
        value={values.amount}
        onChange={(e) => set("amount", e.target.value)}
        {...a11y("amount")}
      />
      {err("amount")}
    </div>
  );

  const today = todayIso();
  const yesterday = yesterdayIso();
  const customDate = pickDate || (values.date !== today && values.date !== yesterday);

  const dateField = sheet ? (
    <div className="chat-field">
      <span className="chat-field__label" aria-hidden="true">
        Data
      </span>
      <ChipGroup label="Data">
        <Chip
          selected={!customDate && values.date === today}
          onClick={() => {
            setPickDate(false);
            set("date", today);
          }}
        >
          Hoje
        </Chip>
        <Chip
          selected={!customDate && values.date === yesterday}
          onClick={() => {
            setPickDate(false);
            set("date", yesterday);
          }}
        >
          Ontem
        </Chip>
        <Chip selected={customDate} icon={CalendarDays} onClick={() => setPickDate(true)}>
          Escolher data
        </Chip>
      </ChipGroup>
      {customDate ? (
        <>
          <label className="visually-hidden" htmlFor={id("date")}>
            Escolha o dia
          </label>
          <input
            id={id("date")}
            className="chat-control"
            type="date"
            value={values.date}
            onChange={(e) => set("date", e.target.value)}
            {...a11y("date")}
          />
        </>
      ) : null}
      {err("date")}
    </div>
  ) : (
    <div className="chat-field">
      <label htmlFor={id("date")}>Data</label>
      <input
        id={id("date")}
        className="chat-control"
        type="date"
        value={values.date}
        onChange={(e) => set("date", e.target.value)}
        {...a11y("date")}
      />
      {err("date")}
    </div>
  );

  const rest = (
    <>
      <div className="chat-field">
        <label htmlFor={id("account")}>{values.kind === "transfer" ? "Conta de origem" : "Conta"}</label>
        <select
          id={id("account")}
          className="chat-control"
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
        <div className="chat-field">
          <label htmlFor={id("to")}>Conta de destino</label>
          <select
            id={id("to")}
            className="chat-control"
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
        <div className="chat-field">
          <label htmlFor={id("category")}>Categoria</label>
          <select
            id={id("category")}
            className="chat-control"
            value={values.categoryId}
            onChange={(e) => set("categoryId", e.target.value)}
          >
            <option value="">Sem categoria</option>
            {shownCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="chat-field">
        <label htmlFor={id("owner")}>Dono</label>
        <select
          id={id("owner")}
          className="chat-control"
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

      <div className="chat-field">
        <label htmlFor={id("description")}>Descrição</label>
        <input
          id={id("description")}
          className="chat-control"
          autoComplete="off"
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
          {...a11y("description")}
        />
        {err("description")}
      </div>

      {serverError ? (
        <p className="chat-field-error" role="alert">
          {serverError}
        </p>
      ) : null}

      <div className="chat-actions">
        <Button type="submit" variant="primary" disabled={busy}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button variant={sheet ? "ghost" : "secondary"} onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </>
  );

  if (!sheet) {
    return (
      <form className="tx-form" onSubmit={submit} noValidate>
        {kindField}
        {amountField}
        {dateField}
        {rest}
      </form>
    );
  }

  return (
    <form className="tx-form tx-form--sheet" onSubmit={submit} noValidate>
      <div className={`tx-hero tx-hero--${KIND_TONE[values.kind]}`}>
        <Segmented
          label="Tipo"
          value={values.kind}
          onChange={(k) => set("kind", k)}
          options={SHEET_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k], icon: KIND_ICON[k] }))}
        />
        {amountField}
      </div>
      {dateField}
      {rest}
    </form>
  );
}
