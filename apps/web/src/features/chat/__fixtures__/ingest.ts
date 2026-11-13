import type { Account, Category, Draft, IngestResult, Transaction } from "../types";

export const ME = { id: 1, name: "Matheus", role: "admin", owner: "MATHEUS" } as const;

const account = (id: number, name: string, owner: Account["owner"], type: Account["type"]): Account => ({
  id,
  owner,
  created_by: 1,
  name,
  type,
  initial_balance_cents: 0,
  initial_balance_date: "2026-01-01",
  active: true,
  current_balance_cents: 100_000,
});

export const ACCOUNTS: Account[] = [
  account(1, "Nubank Ruth", "RUTH", "checking"),
  account(2, "Itaú Matheus", "MATHEUS", "checking"),
  account(3, "Cartão Nubank", "RUTH", "credit_card"),
];

export const CATEGORIES: Category[] = [
  { id: 10, name: "Mercado", kind: "expense", is_recurring_card_allowed: false },
  { id: 11, name: "Salário", kind: "income", is_recurring_card_allowed: false },
  { id: 12, name: "Luz", kind: "expense", is_recurring_card_allowed: false },
];

/** Baixa confiança em categoria e valor, possível duplicata e aviso da regra do plano. */
export const DRAFT_MERCADO: Draft = {
  id: 101,
  status: "pending",
  confidence: 0.62,
  low_confidence_fields: ["category_id", "amount_cents"],
  duplicate_of_transaction_id: 55,
  plan_rule_warning: "Gasto novo no cartão que não é recorrente cadastrado.",
  suggested_bill_instance_id: null,
  payload: {
    kind: "expense",
    amount_cents: 4590,
    date: "2026-11-12",
    description: "Supermercado BH",
    account_id: 1,
    to_account_id: null,
    category_id: 10,
    owner: "RUTH",
  },
};

/** Alta confiança, com sugestão de conta a pagar. */
export const DRAFT_LUZ: Draft = {
  id: 102,
  status: "pending",
  confidence: 0.91,
  low_confidence_fields: [],
  duplicate_of_transaction_id: null,
  plan_rule_warning: null,
  suggested_bill_instance_id: 31,
  payload: {
    kind: "expense",
    amount_cents: 18950,
    date: "2026-11-10",
    description: "Luz CEMIG",
    account_id: 2,
    to_account_id: null,
    category_id: 12,
    owner: "MATHEUS",
  },
};

/** Sem conta: não pode ser confirmado até editar. */
export const DRAFT_SEM_CONTA: Draft = {
  ...DRAFT_MERCADO,
  id: 103,
  low_confidence_fields: ["account_id"],
  duplicate_of_transaction_id: null,
  plan_rule_warning: null,
  payload: { ...DRAFT_MERCADO.payload, description: "Padaria", account_id: null, amount_cents: 1250 },
};

export const INGEST_TWO: IngestResult = {
  extraction_id: 7,
  document_type: "receipt",
  warnings: ["Uma linha do extrato estava ilegível."],
  drafts: [DRAFT_MERCADO, DRAFT_LUZ],
};

export const INGEST_ONE: IngestResult = {
  extraction_id: 8,
  document_type: "free_text",
  warnings: [],
  drafts: [DRAFT_LUZ],
};

export function txFrom(draft: Draft, id: number): Transaction {
  const p = draft.payload;
  return {
    id,
    kind: p.kind,
    amount_cents: p.amount_cents,
    date: p.date,
    description: p.description,
    account_id: p.account_id ?? 1,
    to_account_id: p.to_account_id ?? null,
    category_id: p.category_id ?? null,
    owner: p.owner ?? "MATHEUS",
    created_by: 1,
    status: "confirmed",
    source: "chat",
  };
}
