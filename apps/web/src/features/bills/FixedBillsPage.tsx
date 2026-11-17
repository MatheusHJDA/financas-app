import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Plus, Repeat } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../../api/client";
import { Avatar, Button, Card, EmptyState, ErrorState, ListItem, Money, Sheet, Skeleton, SkeletonGroup, StatCard } from "../../ui";
import { useAllAccounts, useAllCategories } from "../accounts/queries";
import { OWNER_LABEL, assertOk } from "../accounts/shared";
import { AFTER_FIXED_WRITE, useMonthInstances, useOverview, useRecurringBills } from "./api";
import { BillFilterBar } from "./BillFilterBar";
import { NO_FILTER, filterBills, isFiltering, type BillFilterState, type BillStatusFilter } from "./billFilters";
import { todayInSP } from "./dueStatus";
import { FixedBillSheet, sheetTitle, type SaveInput, type SheetMode } from "./FixedBillSheet";
import {
  activeTotalCents,
  formatMonth,
  isEnded,
  sortBills,
  startsLater,
  type RecurringBill,
  type RecurringBillCreate,
  type RecurringBillUpdate,
} from "./fixedBillForm";
import { PayableBills } from "./PayableBills";
import "../accounts/ui.css";
import "./bills.css";

const FILTER_KEY = "fixed-bills-filter";
const STATUSES: BillStatusFilter[] = ["all", "open", "paid", "overdue"];

function loadFilter(): BillFilterState {
  try {
    const raw = JSON.parse(localStorage.getItem(FILTER_KEY) ?? "null") as Partial<BillFilterState> | null;
    const status = STATUSES.includes(raw?.status as BillStatusFilter) ? (raw?.status as BillStatusFilter) : "all";
    const categoryId = typeof raw?.categoryId === "number" ? raw.categoryId : null;
    return { status, categoryId };
  } catch {
    return NO_FILTER;
  }
}

function saveFilter(filter: BillFilterState) {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(filter));
  } catch {
    // sem armazenamento: o filtro vale só nesta visita
  }
}

/** Contas fixas (recorrentes): a pagar, listar, criar, editar, encerrar/reativar e excluir. Só grava depois do toque. */
export default function FixedBillsPage() {
  const queryClient = useQueryClient();
  const bills = useRecurringBills();
  const overview = useOverview();
  const accounts = useAllAccounts();
  const categories = useAllCategories();
  const [mode, setMode] = useState<SheetMode | null>(null);
  const [notice, setNotice] = useState("");
  const monthInstances = useMonthInstances();
  const [filter, setFilterState] = useState<BillFilterState>(loadFilter);
  const setFilter = (next: BillFilterState) => {
    setFilterState(next);
    saveFilter(next);
  };

  const afterWrite = () => Promise.all(AFTER_FIXED_WRITE.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));

  const save = useMutation({
    mutationFn: async (input: SaveInput) => {
      if (input.id === null) {
        const { response, error } = await api.POST("/recurring-bills", { body: input.body as RecurringBillCreate });
        assertOk(response, error);
      } else {
        const { response, error } = await api.PATCH("/recurring-bills/{id}", {
          params: { path: { id: input.id } },
          body: input.body as RecurringBillUpdate,
        });
        assertOk(response, error);
      }
    },
    onSuccess: async (_d, input) => {
      setMode(null);
      setNotice(input.notice);
      await afterWrite();
    },
  });

  const remove = useMutation({
    mutationFn: async (bill: RecurringBill) => {
      const { response, error } = await api.DELETE("/recurring-bills/{id}", { params: { path: { id: bill.id } } });
      assertOk(response, error);
    },
    onSuccess: async (_d, bill) => {
      setMode(null);
      setNotice(`${bill.name} excluída.`);
      await afterWrite();
    },
  });

  const go = (next: SheetMode | null) => {
    save.reset();
    remove.reset();
    setNotice("");
    setMode(next);
  };

  const list = useMemo(() => (bills.data ? sortBills(bills.data) : []), [bills.data]);
  const total = bills.data ? activeTotalCents(bills.data) : 0;
  const filtering = isFiltering(filter);
  const today = todayInSP();
  const categoryOptions = useMemo(() => {
    const used = new Set((bills.data ?? []).map((b) => b.category_id));
    return (categories.data ?? []).filter((c) => c.kind === "expense" && used.has(c.id));
  }, [bills.data, categories.data]);
  // Categoria salva que já não existe entre as opções (conta excluída ou outra categoria): volta para "todas".
  if (bills.data && categories.data && filter.categoryId !== null && !categoryOptions.some((c) => c.id === filter.categoryId)) {
    setFilter({ ...filter, categoryId: null });
  }
  const statusLoading = filter.status !== "all" && monthInstances.isLoading;
  const shown = useMemo(() => filterBills(list, monthInstances.data ?? [], filter, today), [list, monthInstances.data, filter, today]);
  const payables = overview.data ? [...overview.data.overdue_bills, ...overview.data.upcoming_bills] : [];
  const shownPay = filterBills(list, payables, filter, today).instances;
  const shownOverdue = shownPay.filter((b) => overview.data?.overdue_bills.some((o) => o.id === b.id));
  const shownUpcoming = shownPay.filter((b) => !shownOverdue.includes(b));
  const nothing = filtering && bills.data && overview.data && monthInstances.data && shown.bills.length === 0 && shownPay.length === 0;
  const current = mode && mode.kind !== "new" ? (list.find((b) => b.id === mode.id) ?? null) : null;
  // A conta aberta no painel sumiu da lista (ex.: excluída em outro aparelho): fecha o painel.
  const sheetOpen = mode !== null && (mode.kind === "new" || current !== null);

  return (
    <section className="bill-page">
      <header className="bill-head">
        <h1>Contas fixas</h1>
        <Button variant="primary" icon={Plus} onClick={() => go({ kind: "new" })}>
          Nova conta fixa
        </Button>
      </header>
      <p className="u8-sr" role="status" aria-live="polite">
        {notice}
      </p>

      {bills.data && list.length > 0 ? (
        <BillFilterBar value={filter} categories={categoryOptions} onChange={setFilter} onClear={() => setFilter(NO_FILTER)} />
      ) : null}

      {nothing ? (
        <EmptyState title="Nenhuma conta com esses filtros." hint="Troque a situação ou a categoria, ou limpe os filtros." />
      ) : (
      <div className="bill-cols">
        <div className="bill-col">
          {overview.isLoading ? <ListSkeleton label="Carregando contas a pagar" rows={2} /> : null}
          {overview.isError ? (
            <ErrorState message="Não foi possível carregar as contas a pagar." onRetry={() => void overview.refetch()} />
          ) : null}
          {overview.data ? <PayableBills upcoming={shownUpcoming} overdue={shownOverdue} /> : null}
        </div>

        <div className="bill-col">
          {bills.isLoading ? <ListSkeleton label="Carregando contas fixas" rows={4} /> : null}
          {bills.isError ? (
            <ErrorState message="Não foi possível carregar as contas fixas." onRetry={() => void bills.refetch()} />
          ) : null}
          {bills.data && list.length === 0 ? (
            <EmptyState title="Nenhuma conta fixa" hint="Cadastre as contas que se repetem todo mês." />
          ) : null}
          {bills.data && list.length > 0 && filter.status !== "all" && monthInstances.isError ? (
            <ErrorState message="Não foi possível carregar as contas do mês." onRetry={() => void monthInstances.refetch()} />
          ) : null}
          {bills.data && list.length > 0 && statusLoading ? <ListSkeleton label="Carregando contas do mês" rows={3} /> : null}
          {bills.data && list.length > 0 && filtering && !statusLoading && !monthInstances.isError && shown.bills.length === 0 ? (
            <EmptyState title="Nenhuma conta cadastrada com esses filtros." />
          ) : null}
          {bills.data && list.length > 0 && !statusLoading && !(filter.status !== "all" && monthInstances.isError) && !(filtering && shown.bills.length === 0) ? (
            <>
              <StatCard
                label="Total mensal"
                icon={CalendarRange}
                tone="info"
                cents={total}
                hint={
                  filtering
                    ? "Inclui as que começam nos próximos meses (todas as contas, sem filtro)"
                    : "Inclui as que começam nos próximos meses"
                }
              />
              <Card title="Cadastradas" icon={Repeat}>
                <ul className="bill-list">
                  {shown.bills.map((bill) => (
                    <li key={bill.id}>
                      <BillRow bill={bill} onOpen={() => go({ kind: "view", id: bill.id })} />
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          ) : null}
        </div>
      </div>
      )}

      <Sheet open={sheetOpen} title={mode ? sheetTitle(mode, current) : ""} onClose={() => go(null)}>
        {mode ? (
          <FixedBillSheet
            mode={mode}
            bill={current}
            accounts={accounts}
            categories={categories}
            save={save}
            remove={remove}
            go={go}
            onClose={() => go(null)}
          />
        ) : null}
      </Sheet>
    </section>
  );
}

function BillRow({ bill, onOpen }: { bill: RecurringBill; onOpen: () => void }) {
  const ended = isEnded(bill);
  return (
    <ListItem
      onClick={onOpen}
      leading={<Avatar name={bill.name} tone={ended ? "neutral" : bill.account_id == null ? "warning" : "expense"} />}
      title={bill.name}
      subtitle={
        <span className="bill-sub">
          <span>
            {OWNER_LABEL[bill.owner]} · vence dia {bill.due_day}
          </span>
          <span className="bill-badges">
            {bill.account_id == null ? <span className="bill-badge bill-badge--late">Sem conta bancária</span> : null}
            {startsLater(bill) ? <span className="bill-badge">{`Começa em ${formatMonth(bill.start_month)}`}</span> : null}
            {bill.end_month ? (
              <span className="bill-badge">
                {ended ? `Encerrada em ${formatMonth(bill.end_month)}` : `encerra em ${formatMonth(bill.end_month)}`}
              </span>
            ) : null}
          </span>
        </span>
      }
      trailing={<Money cents={bill.amount_cents} />}
    />
  );
}

/** Esqueleto com a forma da lista: bolha + duas linhas + valor, por linha. */
function ListSkeleton({ label, rows }: { label: string; rows: number }) {
  return (
    <SkeletonGroup label={label}>
      <Skeleton variant="block" height="72px" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="bill-skel-row">
          <Skeleton variant="circle" />
          <div className="bill-skel-text">
            <Skeleton width="55%" />
            <Skeleton width="35%" />
          </div>
          <Skeleton width="64px" />
        </div>
      ))}
    </SkeletonGroup>
  );
}
