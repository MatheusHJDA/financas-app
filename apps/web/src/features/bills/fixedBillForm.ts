// Contas fixas (recorrentes): valores do formulário, validação e corpo do PATCH com só o que mudou.
// Dinheiro sempre em centavos inteiros (parseBRL: texto -> inteiro, sem float).
import type { components } from "../../api/schema";
import type { Owner } from "../accounts/shared";
import { centsToInput, parseBRL } from "../chat/money";

export type RecurringBill = components["schemas"]["RecurringBill"];
export type RecurringBillCreate = components["schemas"]["RecurringBillCreate"];
export type RecurringBillUpdate = components["schemas"]["RecurringBillUpdate"];

export interface FixedBillValues {
  name: string;
  amount: string;
  dueDay: string;
  accountId: string;
  categoryId: string;
  paymentMethod: string;
  owner: Owner;
  /** "aaaa-mm" (campo de mês). Só na criação. */
  startMonth: string;
}
export type FixedBillField = keyof FixedBillValues;
export type FixedBillErrors = Partial<Record<FixedBillField, string>>;

export const NAME_MAX = 120;
export const PAYMENT_MAX = 40;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

const SP_MONTH = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" });

/** Mês corrente em São Paulo (o mesmo do servidor) como "aaaa-mm", qualquer que seja o fuso do aparelho. */
export function currentMonth(now: Date = new Date()): string {
  const parts = Object.fromEntries(SP_MONTH.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}`;
}

/** Ainda não começou: o mês de início é posterior ao mês corrente. */
export function startsLater(bill: RecurringBill, now: Date = new Date()): boolean {
  return monthOf(bill.start_month) > currentMonth(now);
}

/** "2026-12" -> "2026-12-01" (primeiro dia do mês, como o servidor espera). Inválido -> null. */
export function monthToFirstDay(month: string): string | null {
  return MONTH_RE.test(month) ? `${month}-01` : null;
}

/** "2026-12-01" -> "2026-12". */
export const monthOf = (iso: string): string => iso.slice(0, 7);

/** "2026-12-01" -> "12/2026". */
export function formatMonth(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  return m ? `${m[2]}/${m[1]}` : iso;
}

/** Já terminou: o mês final é anterior ao mês corrente. */
export function isEnded(bill: RecurringBill, now: Date = new Date()): boolean {
  return bill.end_month != null && monthOf(bill.end_month) < currentMonth(now);
}

/** Ordem da lista: dia de vencimento, depois nome. */
export function sortBills(bills: RecurringBill[]): RecurringBill[] {
  return [...bills].sort((a, b) => a.due_day - b.due_day || a.name.localeCompare(b.name, "pt-BR"));
}

/** Compromisso mensal: contas fixas não encerradas, inclusive as que começam nos próximos meses
 * (elas aparecem marcadas com "começa em"). Centavos, soma de inteiros. */
export function activeTotalCents(bills: RecurringBill[], now: Date = new Date()): number {
  return bills.filter((b) => !isEnded(b, now)).reduce((sum, b) => sum + b.amount_cents, 0);
}

const idText = (id: number | null | undefined) => (id == null ? "" : String(id));

export function billToForm(bill: RecurringBill): FixedBillValues {
  return {
    name: bill.name,
    amount: centsToInput(bill.amount_cents),
    dueDay: String(bill.due_day),
    accountId: idText(bill.account_id),
    categoryId: idText(bill.category_id),
    paymentMethod: bill.payment_method ?? "",
    owner: bill.owner,
    startMonth: monthOf(bill.start_month),
  };
}

export function emptyFixedBillForm(owner: Owner, now: Date = new Date()): FixedBillValues {
  return {
    name: "",
    amount: "",
    dueDay: "",
    accountId: "",
    categoryId: "",
    paymentMethod: "",
    owner,
    startMonth: currentMonth(now),
  };
}

export function parseDueDay(input: string): number | null {
  const s = input.trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 31 ? n : null;
}

export interface Parsed {
  name: string;
  amount_cents: number;
  due_day: number;
  account_id: number | null;
  category_id: number | null;
  payment_method: string | null;
  owner: Owner;
  start_month: string | null;
}

export function parseForm(values: FixedBillValues, requireStart: boolean): { parsed: Parsed } | { errors: FixedBillErrors } {
  const errors: FixedBillErrors = {};
  const name = values.name.trim();
  if (!name) errors.name = "Informe o nome da conta.";
  else if (name.length > NAME_MAX) errors.name = `Use até ${NAME_MAX} caracteres.`;

  const cents = parseBRL(values.amount);
  if (cents === null) errors.amount = "Informe um valor maior que zero, como 1.234,56.";

  const dueDay = parseDueDay(values.dueDay);
  if (dueDay === null) errors.dueDay = "Informe um dia de 1 a 31.";

  const payment = values.paymentMethod.trim();
  if (payment.length > PAYMENT_MAX) errors.paymentMethod = `Use até ${PAYMENT_MAX} caracteres.`;

  let start: string | null = null;
  if (requireStart) {
    start = monthToFirstDay(values.startMonth);
    if (start === null) errors.startMonth = "Informe o mês de início.";
  }

  if (Object.keys(errors).length > 0 || cents === null || dueDay === null) return { errors };
  return {
    parsed: {
      name,
      amount_cents: cents,
      due_day: dueDay,
      account_id: values.accountId ? Number(values.accountId) : null,
      category_id: values.categoryId ? Number(values.categoryId) : null,
      payment_method: payment || null,
      owner: values.owner,
      start_month: start,
    },
  };
}

/** Corpo do POST. Campos vazios (conta, categoria, forma de pagamento) ficam de fora. */
export function toCreateBody(p: Parsed): RecurringBillCreate {
  const body: RecurringBillCreate = {
    owner: p.owner,
    name: p.name,
    amount_cents: p.amount_cents,
    due_day: p.due_day,
    start_month: p.start_month ?? `${currentMonth()}-01`,
  };
  if (p.account_id !== null) body.account_id = p.account_id;
  if (p.category_id !== null) body.category_id = p.category_id;
  if (p.payment_method !== null) body.payment_method = p.payment_method;
  return body;
}

/** Corpo do PATCH com só o que mudou. Objeto vazio = nada a gravar. */
export function toPatchBody(bill: RecurringBill, p: Parsed): RecurringBillUpdate {
  const patch: RecurringBillUpdate = {};
  if (p.name !== bill.name) patch.name = p.name;
  if (p.amount_cents !== bill.amount_cents) patch.amount_cents = p.amount_cents;
  if (p.due_day !== bill.due_day) patch.due_day = p.due_day;
  if (p.account_id !== (bill.account_id ?? null)) patch.account_id = p.account_id;
  if (p.category_id !== (bill.category_id ?? null)) patch.category_id = p.category_id;
  if (p.payment_method !== (bill.payment_method?.trim() || null)) patch.payment_method = p.payment_method;
  if (p.owner !== bill.owner) patch.owner = p.owner;
  if (p.start_month !== null && p.start_month !== bill.start_month) patch.start_month = p.start_month;
  return patch;
}
