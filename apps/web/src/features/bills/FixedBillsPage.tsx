import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Plus, Repeat } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client";
import { Avatar, Button, Card, EmptyState, ErrorState, ListItem, Money, Sheet, Skeleton, SkeletonGroup, StatCard } from "../../ui";
import { useAllAccounts, useAllCategories } from "../accounts/queries";
import { OWNER_LABEL, assertOk } from "../accounts/shared";
import { AFTER_FIXED_WRITE, useOverview, useRecurringBills } from "./api";
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

/** Contas fixas (recorrentes): a pagar, listar, criar, editar, encerrar/reativar e excluir. Só grava depois do toque. */
export default function FixedBillsPage() {
  const queryClient = useQueryClient();
  const bills = useRecurringBills();
  const overview = useOverview();
  const accounts = useAllAccounts();
  const categories = useAllCategories();
  const [mode, setMode] = useState<SheetMode | null>(null);
  const [notice, setNotice] = useState("");

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

  const list = bills.data ? sortBills(bills.data) : [];
  const total = bills.data ? activeTotalCents(bills.data) : 0;
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

      <div className="bill-cols">
        <div className="bill-col">
          {overview.isLoading ? <ListSkeleton label="Carregando contas a pagar" rows={2} /> : null}
          {overview.isError ? (
            <ErrorState message="Não foi possível carregar as contas a pagar." onRetry={() => void overview.refetch()} />
          ) : null}
          {overview.data ? <PayableBills upcoming={overview.data.upcoming_bills} overdue={overview.data.overdue_bills} /> : null}
        </div>

        <div className="bill-col">
          {bills.isLoading ? <ListSkeleton label="Carregando contas fixas" rows={4} /> : null}
          {bills.isError ? (
            <ErrorState message="Não foi possível carregar as contas fixas." onRetry={() => void bills.refetch()} />
          ) : null}
          {bills.data && list.length === 0 ? (
            <EmptyState title="Nenhuma conta fixa" hint="Cadastre as contas que se repetem todo mês." />
          ) : null}
          {bills.data && list.length > 0 ? (
            <>
              <StatCard
                label="Total mensal"
                icon={CalendarRange}
                tone="info"
                cents={total}
                hint="Inclui as que começam nos próximos meses"
              />
              <Card title="Cadastradas" icon={Repeat}>
                <ul className="bill-list">
                  {list.map((bill) => (
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
