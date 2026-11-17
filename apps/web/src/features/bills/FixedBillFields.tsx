import { useId, useState, type FormEvent } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { accountOptionLabel, canWrite, OWNER_LABEL, OWNERS, type Account, type Category, type Owner } from "../accounts/shared";
import {
  parseForm,
  toCreateBody,
  toPatchBody,
  type FixedBillErrors,
  type FixedBillField,
  type FixedBillValues,
  type RecurringBill,
  type RecurringBillCreate,
  type RecurringBillUpdate,
} from "./fixedBillForm";

const PAYMENT_SUGGESTIONS = ["Boleto", "Pix", "Cartão", "Débito automático", "Dinheiro"];

/** Opções da lista; um valor antigo fora dela continua aparecendo para não se perder. */
function paymentOptions(current: string): string[] {
  const value = current.trim();
  return value && !PAYMENT_SUGGESTIONS.includes(value) ? [...PAYMENT_SUGGESTIONS, value] : PAYMENT_SUGGESTIONS;
}

interface Props {
  /** Edição: a conta fixa aberta. Criação: omitido. */
  bill?: RecurringBill;
  initial: FixedBillValues;
  accounts: Account[];
  categories: Category[];
  busy?: boolean;
  serverError?: string | null;
  onSubmitCreate?: (body: RecurringBillCreate) => void;
  onSubmitEdit?: (body: RecurringBillUpdate) => void;
  onCancel: () => void;
}

/** Formulário de conta fixa. Valor em R$ ("1.234,56") vira centavos inteiros; edição manda só o que mudou. */
export function FixedBillForm({
  bill,
  initial,
  accounts,
  categories,
  busy = false,
  serverError = null,
  onSubmitCreate,
  onSubmitEdit,
  onCancel,
}: Props) {
  const { me } = useAuth();
  const uid = useId();
  const editing = bill !== undefined;
  const [values, setValues] = useState<FixedBillValues>(initial);
  const [errors, setErrors] = useState<FixedBillErrors>({});

  const set = <K extends FixedBillField>(field: K, value: FixedBillValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const result = parseForm(values, true);
    if ("errors" in result) {
      setErrors(result.errors);
      return;
    }
    if (bill?.end_month && result.parsed.start_month && result.parsed.start_month > bill.end_month) {
      setErrors({ startMonth: "O mês de início não pode ser depois do mês de encerramento." });
      return;
    }
    setErrors({});
    if (bill) onSubmitEdit?.(toPatchBody(bill, result.parsed));
    else onSubmitCreate?.(toCreateBody(result.parsed));
  };

  const id = (f: string) => `${uid}-${f}`;
  const err = (f: FixedBillField) =>
    errors[f] ? (
      <p id={id(`${f}-err`)} className="u8-err" role="alert">
        {errors[f]}
      </p>
    ) : null;
  const a11y = (f: FixedBillField, extra?: string) => {
    const ids = [errors[f] ? id(`${f}-err`) : "", extra ?? ""].filter(Boolean).join(" ");
    return { ...(errors[f] ? { "aria-invalid": true } : {}), ...(ids ? { "aria-describedby": ids } : {}) };
  };

  // Só contas que o usuário movimenta (dono = ele, AMBOS ou admin); o servidor devolve 403 nas outras.
  const movable = accounts.filter((a) => canWrite(me, a.owner));
  // A conta ORIGINAL (de quem o usuário não movimenta) continua escolhível mesmo depois de trocar no seletor.
  const originalAccount = bill?.account_id != null ? String(bill.account_id) : "";
  const currentAccountHidden = originalAccount !== "" && !movable.some((a) => String(a.id) === originalAccount);
  const expense = categories.filter((c) => c.kind === "expense");
  const originalCategory = bill?.category_id != null ? String(bill.category_id) : "";
  const currentCategoryHidden = originalCategory !== "" && !expense.some((c) => String(c.id) === originalCategory);
  const owners = OWNERS.filter((o) => canWrite(me, o) || o === bill?.owner);

  return (
    <form
      className="u8-form"
      onSubmit={submit}
      noValidate
      aria-label={editing ? `Editar conta fixa ${bill.name}` : "Nova conta fixa"}
    >
      <div className="u8-field">
        <label htmlFor={id("name")}>Nome da conta fixa</label>
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
        <label htmlFor={id("amount")}>Valor mensal (R$)</label>
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
        <label htmlFor={id("due")}>Dia do vencimento (1 a 31)</label>
        <input
          id={id("due")}
          inputMode="numeric"
          autoComplete="off"
          maxLength={2}
          value={values.dueDay}
          onChange={(e) => set("dueDay", e.target.value)}
          {...a11y("dueDay", id("due-hint"))}
        />
        <p id={id("due-hint")} className="muted u8-small" style={{ margin: 0 }}>
          Dias 29, 30 e 31 viram o último dia do mês nos meses mais curtos.
        </p>
        {err("dueDay")}
      </div>

      <div className="u8-field">
        <label htmlFor={id("account")}>Conta bancária (de onde sai o pagamento)</label>
        <select id={id("account")} value={values.accountId} onChange={(e) => set("accountId", e.target.value)}>
          <option value="">Sem conta bancária</option>
          {currentAccountHidden ? <option value={originalAccount}>Manter a conta atual</option> : null}
          {movable.map((a) => (
            <option key={a.id} value={a.id}>
              {accountOptionLabel(a)}
            </option>
          ))}
        </select>
        {values.accountId === "" ? (
          <p className="u8-small" style={{ margin: 0 }}>
            Sem conta bancária não dá para marcar como paga.
          </p>
        ) : null}
      </div>

      <div className="u8-field">
        <label htmlFor={id("category")}>Categoria</label>
        <select id={id("category")} value={values.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
          <option value="">Sem categoria</option>
          {currentCategoryHidden ? <option value={originalCategory}>Manter a categoria atual</option> : null}
          {expense.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="u8-field">
        <label htmlFor={id("payment")}>Forma de pagamento (opcional)</label>
        <select
          id={id("payment")}
          value={values.paymentMethod}
          onChange={(e) => set("paymentMethod", e.target.value)}
          {...a11y("paymentMethod")}
        >
          <option value="">Sem forma de pagamento</option>
          {paymentOptions(values.paymentMethod).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        {err("paymentMethod")}
      </div>

      <div className="u8-field">
        <label htmlFor={id("owner")}>Dono</label>
        <select id={id("owner")} value={values.owner} onChange={(e) => set("owner", e.target.value as Owner)}>
          {owners.map((o) => (
            <option key={o} value={o}>
              {OWNER_LABEL[o]}
            </option>
          ))}
        </select>
      </div>

      <div className="u8-field">
        <label htmlFor={id("start")}>Mês de início</label>
        <input
          id={id("start")}
          type="month"
          value={values.startMonth}
          onChange={(e) => set("startMonth", e.target.value)}
          {...a11y("startMonth")}
        />
        {err("startMonth")}
      </div>

      {editing ? (
        <p className="u8-note">
          Ao salvar, o novo valor e o novo vencimento valem para as contas a pagar em aberto deste mês em diante. O que já
          foi pago não muda. Mudar o mês de início não cria contas de meses passados; contas em aberto antes do novo
          início são removidas.
        </p>
      ) : null}

      {serverError ? (
        <p className="u8-err" role="alert">
          {serverError}
        </p>
      ) : null}

      <div className="u8-actions">
        <button type="submit" className="u8-btn u8-btn--primary" disabled={busy}>
          {editing ? "Salvar conta fixa" : "Criar conta fixa"}
        </button>
        <button type="button" className="u8-btn" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
