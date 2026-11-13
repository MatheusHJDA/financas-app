import type { components } from "../../api/schema";

export type Account = components["schemas"]["Account"];
export type Category = components["schemas"]["Category"];
export type Owner = components["schemas"]["Owner"];
export type TxKind = components["schemas"]["TxKind"];
export type Draft = components["schemas"]["Draft"];
export type IngestResult = components["schemas"]["IngestResult"];
export type Proposal = components["schemas"]["ProposedTransaction"];
export type Transaction = components["schemas"]["Transaction"];

export const OWNER_LABEL: Record<Owner, string> = { RUTH: "Ruth", MATHEUS: "Matheus", AMBOS: "Ambos" };
export const KIND_LABEL: Record<TxKind, string> = {
  expense: "Despesa",
  income: "Receita",
  transfer: "Transferência",
};
export const OWNERS: Owner[] = ["RUTH", "MATHEUS", "AMBOS"];
export const KINDS: TxKind[] = ["expense", "income", "transfer"];
