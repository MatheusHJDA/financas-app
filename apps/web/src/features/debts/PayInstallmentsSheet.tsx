import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { Button, Money, Sheet } from "../../ui";
import { useAllAccounts } from "../accounts/queries";
import { ApiError, accountOptionLabel, errorMessage } from "../accounts/shared";
import { todayIso } from "../chat/dates";
import { centsToInput, parseBRL } from "../chat/money";
import { AFTER_LOAN_PAID, payInstallments, type Installment } from "./api";
import "./loan.css";

interface Props {
  open: boolean;
  debtId: number;
  /** Parcelas escolhidas, com a estimativa de hoje (`today_cents`). */
  selected: Installment[];
  /** Conta da conta fixa da dívida; null quando não há. */
  defaultAccountId: number | null;
  onClose: () => void;
  /** Chamado depois de gravar (a lista já foi invalidada). */
  onDone: () => void;
}

const sum = (items: Installment[], pick: (i: Installment) => number) => items.reduce((s, i) => s + pick(i), 0);

/** Revisa e confirma o pagamento (ou adiantamento) de parcelas: uma despesa no valor realmente cobrado. */
export function PayInstallmentsSheet(props: Props) {
  return (
    <Sheet open={props.open} title="Revisar pagamento" onClose={props.onClose}>
      <PayForm {...props} />
    </Sheet>
  );
}

function PayForm({ debtId, selected, defaultAccountId, onClose, onDone }: Props) {
  const uid = useId();
  const queryClient = useQueryClient();
  const accounts = useAllAccounts();
  const estimate = sum(selected, (i) => i.today_cents ?? i.face_cents);
  const savings = sum(selected, (i) => i.savings_cents ?? 0);
  const [amount, setAmount] = useState(centsToInput(estimate));
  const [accountChoice, setAccountChoice] = useState<string | null>(null);
  const [date, setDate] = useState(todayIso());
  const [fieldError, setFieldError] = useState("");

  const accountId = accountChoice ?? (defaultAccountId != null ? String(defaultAccountId) : "");
  const options = (accounts.data ?? []).filter((a) => a.active && a.type !== "credit_card" && a.type !== "loan");

  const pay = useMutation({
    mutationFn: () =>
      payInstallments(debtId, {
        installment_ids: selected.map((i) => i.id),
        amount_cents: parseBRL(amount) ?? 0,
        account_id: Number(accountId),
        date,
      }),
    onSuccess: async () => {
      await Promise.all(AFTER_LOAN_PAID.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      onDone();
    },
    onError: (error) => {
      // 409: alguma parcela já foi paga em outro lugar; a lista está velha.
      if (error instanceof ApiError && error.status === 409) void queryClient.invalidateQueries({ queryKey: ["debts"] });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pay.isPending) return;
    if (parseBRL(amount) === null) return setFieldError("Informe o valor cobrado.");
    if (!accountId) return setFieldError("Escolha a conta de onde saiu o dinheiro.");
    if (!date) return setFieldError("Informe a data do pagamento.");
    setFieldError("");
    pay.mutate();
  };

  const error = fieldError || (pay.isError ? errorMessage(pay.error, "Você não pode pagar essa parcela.") : "");
  const id = (f: string) => `${uid}-${f}`;

  return (
    <form className="u8-form" onSubmit={submit} noValidate aria-label="Pagar parcelas">
      <p className="loan-sheet__sum">
        {selected.length === 1 ? "1 parcela" : `${selected.length} parcelas`} · estimativa <Money cents={estimate} />
        {savings > 0 ? (
          <>
            <br />
            Você economiza <Money cents={savings} />
          </>
        ) : null}
      </p>
      <div className="u8-field">
        <label htmlFor={id("amount")}>Valor cobrado</label>
        <input id={id("amount")} inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="u8-field">
        <label htmlFor={id("account")}>Conta</label>
        <select id={id("account")} value={accountId} onChange={(e) => setAccountChoice(e.target.value)}>
          <option value="">Escolha a conta</option>
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {accountOptionLabel(a)}
            </option>
          ))}
        </select>
      </div>
      <div className="u8-field">
        <label htmlFor={id("date")}>Data</label>
        <input id={id("date")} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      {error ? (
        <p className="u8-err" role="alert">
          {error}
        </p>
      ) : null}
      <div className="u8-actions">
        <Button type="submit" variant="primary" disabled={pay.isPending}>
          {pay.isPending ? "Gravando…" : "Confirmar pagamento"}
        </Button>
        <Button variant="secondary" disabled={pay.isPending} onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
