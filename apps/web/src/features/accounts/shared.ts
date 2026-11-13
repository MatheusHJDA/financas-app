// Peças comuns das telas Geral e Metas (U8): tipos, rótulos, permissão no front e erros da API.
// Quem decide é o servidor (D6/D12); aqui só se esconde o que o usuário não poderia fazer.
import type { components } from "../../api/schema";
import type { Me } from "../../auth/AuthProvider";
import { OWNER_LABEL } from "../chat/types";

export type Account = components["schemas"]["Account"];
export type AccountType = components["schemas"]["AccountType"];
export type Category = components["schemas"]["Category"];
export type Owner = components["schemas"]["Owner"];
export type Transaction = components["schemas"]["Transaction"];
export type BillInstance = components["schemas"]["BillInstance"];
export type Goal = components["schemas"]["Goal"];

export { OWNER_LABEL };
export const OWNERS: Owner[] = ["RUTH", "MATHEUS", "AMBOS"];

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  checking: "Conta corrente",
  savings: "Poupança",
  cash: "Dinheiro",
  meal_voucher: "Vale-refeição",
  credit_card: "Cartão de crédito",
  loan: "Empréstimo",
};
export const ACCOUNT_TYPES = Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[];

/** D6/D12: admin escreve em tudo; registros AMBOS valem para os dois; senão só o dono. */
export function canWrite(me: Me | null | undefined, owner: Owner | null | undefined): boolean {
  if (!me) return false;
  if (me.role === "admin") return true;
  if (owner == null) return false;
  return owner === "AMBOS" || owner === me.owner;
}

/** Erro de uma chamada à API, com o status HTTP e o `detail` do servidor (quando for texto). */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: string | null;
  constructor(status: number, detail: string | null) {
    super(detail ?? `HTTP ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

/** Lança ApiError quando a resposta não é 2xx. `error` é o corpo já lido pelo openapi-fetch. */
export function assertOk(response: Response, error: unknown): void {
  if (response.ok) return;
  const detail = (error as { detail?: unknown } | undefined)?.detail;
  throw new ApiError(response.status, typeof detail === "string" ? detail : null);
}

/** Mensagem para o usuário. `forbidden` troca o texto do 403 (ex.: "Você não pode alterar esse lançamento."). */
export function errorMessage(error: unknown, forbidden: string): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return forbidden;
    if (error.detail) return error.detail;
  }
  return "Não foi possível concluir. Tente de novo.";
}

export const accountOptionLabel = (a: Account) =>
  `${a.name} (${OWNER_LABEL[a.owner]})${a.active ? "" : " — inativa"}`;
