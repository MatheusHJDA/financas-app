import { describe, expect, it } from "vitest";
import type { BillInstance } from "../accounts/shared";
import { filterBills } from "./billFilters";
import type { RecurringBill } from "./fixedBillForm";

const TODAY = "2026-11-14";
const bill = (id: number, category_id: number | null): RecurringBill => ({
  id,
  owner: "AMBOS",
  name: `C${id}`,
  amount_cents: 100,
  due_day: 1,
  start_month: "2026-01-01",
  end_month: null,
  account_id: 1,
  category_id,
  payment_method: null,
});
const inst = (id: number, due: string, status: BillInstance["status"]): BillInstance => ({
  id,
  recurring_bill_id: id,
  month: "2026-11-01",
  due_date: due,
  amount_cents: 100,
  status,
});

const bills = [bill(1, 10), bill(2, 10), bill(3, 20), bill(4, 20), bill(5, 30)];
const instances = [
  inst(1, "2026-11-20", "open"),
  inst(2, "2026-11-05", "open"),
  inst(3, "2026-11-03", "paid"),
  inst(4, "2026-11-10", "prepaid"),
];
const ids = (r: { bills: RecurringBill[] }) => r.bills.map((b) => b.id);

describe("filterBills", () => {
  it("Todas sem categoria não filtra nada", () => {
    const r = filterBills(bills, instances, { status: "all", categoryId: null }, TODAY);
    expect(ids(r)).toEqual([1, 2, 3, 4, 5]);
    expect(r.instances).toHaveLength(4);
  });
  it("A pagar: só aberta e não vencida", () => {
    const r = filterBills(bills, instances, { status: "open", categoryId: null }, TODAY);
    expect(ids(r)).toEqual([1]);
  });
  it("Vencidas: só aberta com vencimento antes de hoje", () => {
    const r = filterBills(bills, instances, { status: "overdue", categoryId: null }, TODAY);
    expect(ids(r)).toEqual([2]);
  });
  it("Pagas: paga e adiantada contam", () => {
    const r = filterBills(bills, instances, { status: "paid", categoryId: null }, TODAY);
    expect(ids(r)).toEqual([3, 4]);
    expect(r.instances.map((i) => i.id)).toEqual([3, 4]);
  });
  it("categoria filtra as duas listas", () => {
    const r = filterBills(bills, instances, { status: "all", categoryId: 20 }, TODAY);
    expect(ids(r)).toEqual([3, 4]);
    expect(r.instances.map((i) => i.id)).toEqual([3, 4]);
  });
  it("situação e categoria combinam", () => {
    const r = filterBills(bills, instances, { status: "paid", categoryId: 10 }, TODAY);
    expect(ids(r)).toEqual([]);
  });
});
