import type { components } from "../../api/schema";
import { isValidIsoDate, todayIso } from "../chat/dates";
import { parseSignedBRL, signedCentsToInput } from "./money";
import type { Account, AccountType, Owner } from "./shared";

export type AccountBody = components["schemas"]["AccountCreate"];

/** Valores do formulário de conta: tudo texto, como vem dos campos. */
export interface AccountFormValues {
  type: AccountType;
  name: string;
  owner: Owner;
  institution: string;
  last4: string;
  balance: string; // "1.234,56" ou "-5.000,00"
  balanceDate: string; // aaaa-mm-dd
  closingDay: string;
  dueDay: string;
  active: boolean;
}

export type AccountFormErrors = Partial<Record<keyof AccountFormValues, string>>;

export function emptyAccountForm(owner: Owner): AccountFormValues {
  return {
    type: "checking",
    name: "",
    owner,
    institution: "",
    last4: "",
    balance: "",
    balanceDate: todayIso(),
    closingDay: "",
    dueDay: "",
    active: true,
  };
}

export function accountToForm(a: Account): AccountFormValues {
  return {
    type: a.type,
    name: a.name,
    owner: a.owner,
    institution: a.institution ?? "",
    last4: a.last4 ?? "",
    balance: signedCentsToInput(a.initial_balance_cents),
    balanceDate: a.initial_balance_date,
    closingDay: a.closing_day == null ? "" : String(a.closing_day),
    dueDay: a.due_day == null ? "" : String(a.due_day),
    active: a.active,
  };
}

function parseDay(text: string): number | null | "invalid" {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d{1,2}$/.test(t)) return "invalid";
  const n = Number(t);
  return n >= 1 && n <= 31 ? n : "invalid";
}

/** Texto do formulário -> corpo da API (saldo em centavos inteiros) ou erros por campo. */
export function formToAccountBody(v: AccountFormValues): { body: AccountBody } | { errors: AccountFormErrors } {
  const errors: AccountFormErrors = {};
  const name = v.name.trim();
  if (!name) errors.name = "Informe o nome da conta.";

  const cents = parseSignedBRL(v.balance);
  if (cents === null) errors.balance = "Informe o saldo inicial, por exemplo 1.234,56 (com - se for negativo).";
  else if (v.type === "loan" && cents > 0) {
    errors.balance = "Empréstimo: informe o saldo negativo (o que você deve), por exemplo -5.000,00.";
  }
  if (!isValidIsoDate(v.balanceDate)) errors.balanceDate = "Informe uma data válida.";

  const last4 = v.last4.trim();
  if (last4 && !/^\d{4}$/.test(last4)) errors.last4 = "Use os 4 últimos dígitos.";

  const isCard = v.type === "credit_card";
  const closing = isCard ? parseDay(v.closingDay) : null;
  const due = isCard ? parseDay(v.dueDay) : null;
  if (closing === "invalid") errors.closingDay = "Use um dia de 1 a 31.";
  if (due === "invalid") errors.dueDay = "Use um dia de 1 a 31.";

  if (Object.keys(errors).length > 0 || cents === null) return { errors };
  return {
    body: {
      owner: v.owner,
      name,
      type: v.type,
      institution: v.institution.trim() || null,
      last4: last4 || null,
      initial_balance_cents: cents,
      initial_balance_date: v.balanceDate,
      closing_day: closing === "invalid" ? null : closing,
      due_day: due === "invalid" ? null : due,
      active: v.active,
    },
  };
}
