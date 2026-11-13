import { isValidIsoDate, todayIso } from "./dates";
import { centsToInput, parseBRL } from "./money";
import type { Owner, Proposal, TxKind } from "./types";

/** Valores do formulário (Editar e Lançar à mão): tudo texto, como vem dos campos. */
export interface FormValues {
  kind: TxKind;
  amount: string; // "1.234,56"
  date: string; // aaaa-mm-dd
  accountId: string;
  toAccountId: string;
  categoryId: string;
  owner: string;
  description: string;
}

export type FormField = keyof FormValues;
export type FormErrors = Partial<Record<FormField, string>>;

export function emptyForm(owner: Owner): FormValues {
  return {
    kind: "expense",
    amount: "",
    date: todayIso(),
    accountId: "",
    toAccountId: "",
    categoryId: "",
    owner,
    description: "",
  };
}

const idText = (id: number | null | undefined) => (id == null ? "" : String(id));

export function proposalToForm(p: Proposal, fallbackOwner: Owner): FormValues {
  return {
    kind: p.kind,
    amount: centsToInput(p.amount_cents),
    date: p.date,
    accountId: idText(p.account_id),
    toAccountId: idText(p.to_account_id),
    categoryId: idText(p.category_id),
    owner: p.owner ?? fallbackOwner,
    description: p.description,
  };
}

/** Texto do formulário -> proposta (valor em centavos inteiros) ou erros por campo. */
export function formToProposal(v: FormValues): { proposal: Proposal } | { errors: FormErrors } {
  const errors: FormErrors = {};
  const cents = parseBRL(v.amount);
  if (cents === null) errors.amount = "Informe um valor maior que zero, por exemplo 1.234,56.";
  if (!isValidIsoDate(v.date)) errors.date = "Informe uma data válida.";
  if (!v.accountId) errors.accountId = "Escolha a conta.";
  if (v.kind === "transfer") {
    if (!v.toAccountId) errors.toAccountId = "Escolha a conta de destino.";
    else if (v.toAccountId === v.accountId) errors.toAccountId = "O destino deve ser outra conta.";
  }
  if (!v.owner) errors.owner = "Escolha o dono.";
  const description = v.description.trim();
  if (!description) errors.description = "Informe a descrição.";
  if (Object.keys(errors).length > 0 || cents === null) return { errors };

  return {
    proposal: {
      kind: v.kind,
      amount_cents: cents,
      date: v.date,
      description,
      account_id: Number(v.accountId),
      to_account_id: v.kind === "transfer" ? Number(v.toAccountId) : null,
      category_id: v.kind !== "transfer" && v.categoryId ? Number(v.categoryId) : null,
      owner: v.owner as Owner,
    },
  };
}

/** O rascunho pode ser confirmado como está? Devolve o que falta, ou null. */
export function missingForConfirm(p: Proposal): string | null {
  if (p.account_id == null) return "Escolha a conta em Editar antes de confirmar.";
  if (p.kind === "transfer") {
    if (p.to_account_id == null) return "Escolha a conta de destino em Editar antes de confirmar.";
    if (p.to_account_id === p.account_id) return "A transferência precisa de duas contas diferentes.";
  }
  return null;
}
