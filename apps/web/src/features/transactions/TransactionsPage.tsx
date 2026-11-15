import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { Button, Card, EmptyState, ErrorState, Skeleton, SkeletonGroup } from "../../ui";
import { useAllAccounts, useAllCategories } from "../accounts/queries";
import { assertOk, errorMessage, type Transaction } from "../accounts/shared";
import type { Proposal } from "../chat/types";
import { EMPTY_FILTERS, exportHref, filtersToQuery, PAGE_SIZE, todaySP, type TxFilters } from "./filters";
import { TransactionFilters } from "./TransactionFilters";
import { TransactionList } from "./TransactionList";
import { DeleteTransactionSheet, TransactionSheet } from "./TransactionSheet";
import "./transactions.css";

const FORBIDDEN = "Você não pode alterar esse lançamento.";
const WRITE_PREFIXES = ["transactions", "overview", "accounts", "goals", "bill-instances", "report"];

function ListSkeleton() {
  return (
    <SkeletonGroup label="Carregando movimentações">
      {[3, 2].map((rows, g) => (
        <div key={g} className="tx-day">
          <Skeleton width="7rem" />
          <div className="tx-day__list">
            {Array.from({ length: rows }, (_v, i) => (
              <div key={i} className="tx-skel-row">
                <Skeleton variant="circle" width="40px" height="40px" />
                <div className="tx-skel-row__text">
                  <Skeleton width="60%" />
                  <Skeleton width="40%" />
                </div>
                <Skeleton width="4.5rem" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </SkeletonGroup>
  );
}

export default function TransactionsPage() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const accounts = useAllAccounts();
  const categories = useAllCategories();

  const [filters, setFilters] = useState<TxFilters>(EMPTY_FILTERS);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [notice, setNotice] = useState("");

  const query = filtersToQuery(filters);
  const list = useQuery({
    queryKey: ["transactions", "list", query, page],
    queryFn: async () => {
      const { data, response } = await api.GET("/transactions", {
        params: { query: { ...query, limit: PAGE_SIZE, offset: page * PAGE_SIZE } },
      });
      if (!data) throw new Error(`HTTP ${response.status}`);
      return data;
    },
    placeholderData: keepPreviousData,
  });

  const afterWrite = () => Promise.all(WRITE_PREFIXES.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));

  const update = useMutation({
    mutationFn: async (input: { tx: Transaction; body: Proposal }) => {
      const { response, error } = await api.PATCH("/transactions/{id}", {
        params: { path: { id: input.tx.id } },
        body: {
          kind: input.body.kind,
          amount_cents: input.body.amount_cents,
          date: input.body.date,
          description: input.body.description,
          account_id: input.body.account_id ?? input.tx.account_id,
          to_account_id: input.body.to_account_id ?? null,
          category_id: input.body.category_id ?? null,
          owner: input.body.owner ?? input.tx.owner,
        },
      });
      assertOk(response, error);
    },
    onSuccess: async () => {
      setEditing(null);
      setNotice("Lançamento atualizado.");
      await afterWrite();
    },
  });

  const remove = useMutation({
    mutationFn: async (tx: Transaction) => {
      const { response, error } = await api.DELETE("/transactions/{id}", { params: { path: { id: tx.id } } });
      assertOk(response, error);
    },
    onSuccess: async () => {
      setDeleting(null);
      setNotice("Lançamento excluído.");
      await afterWrite();
    },
  });

  const change = (patch: Partial<TxFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(0);
  };
  const clear = () => {
    setSearch("");
    change(EMPTY_FILTERS);
  };

  const openEdit = (tx: Transaction) => {
    update.reset();
    setNotice("");
    setEditing(tx);
  };
  const openDelete = (tx: Transaction) => {
    remove.reset();
    setNotice("");
    setDeleting(tx);
  };
  const closeEdit = () => {
    update.reset();
    setEditing(null);
  };
  const closeDelete = () => {
    remove.reset();
    setDeleting(null);
  };

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE + items.length);
  const hasFilters = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  return (
    <section className="tx-page">
      <h1>Transações</h1>

      <TransactionFilters
        filters={filters}
        accounts={accounts.data ?? []}
        categories={categories.data ?? []}
        search={search}
        canClear={hasFilters || search !== ""}
        onSearchChange={setSearch}
        onSearch={() => change({ q: search })}
        onChange={change}
        onClear={clear}
      />

      <section className="tx-results" aria-labelledby="tx-title">
        <h2 id="tx-title">Movimentações</h2>

        {notice ? (
          <p className="tx-notice" role="status">
            {notice}
          </p>
        ) : null}
        <p className="visually-hidden" role="status" aria-live="polite">
          {list.data ? `${total} ${total === 1 ? "lançamento" : "lançamentos"}.` : ""}
        </p>

        {list.isLoading ? <ListSkeleton /> : null}
        {list.isError ? <ErrorState message="Não foi possível carregar as movimentações." onRetry={() => void list.refetch()} /> : null}

        {list.data && items.length === 0 ? (
          <EmptyState
            title="Nenhuma movimentação"
            hint={hasFilters ? "Nada casa com esses filtros." : "Os lançamentos feitos pelo chat aparecem aqui."}
          />
        ) : null}

        {items.length > 0 ? (
          <TransactionList
            items={items}
            accounts={accounts.data ?? []}
            categories={categories.data ?? []}
            me={me}
            today={todaySP()}
            onEdit={openEdit}
            onDelete={openDelete}
          />
        ) : null}

        {total > 0 ? (
          <Card className="tx-pager">
            <nav aria-label="Páginas de movimentações">
              <p className="tx-pager__info">
                Mostrando {from}–{to} de {total}
              </p>
              <div className="tx-actions">
                <Button disabled={page === 0 || list.isFetching} onClick={() => setPage((p) => p - 1)}>
                  Anterior
                </Button>
                <Button disabled={to >= total || list.isFetching} onClick={() => setPage((p) => p + 1)}>
                  Próxima
                </Button>
              </div>
            </nav>
          </Card>
        ) : null}

        <a className="ui-btn ui-btn--secondary tx-export" href={exportHref(filters)} download>
          <Download aria-hidden="true" size={18} strokeWidth={1.75} />
          Exportar CSV
        </a>
      </section>

      <TransactionSheet
        tx={editing}
        accounts={accounts.data ?? []}
        categories={categories.data ?? []}
        busy={update.isPending}
        serverError={update.isError ? errorMessage(update.error, FORBIDDEN) : null}
        onSubmit={(tx, body) => update.mutate({ tx, body })}
        onClose={closeEdit}
      />
      <DeleteTransactionSheet
        tx={deleting}
        busy={remove.isPending}
        error={remove.isError ? errorMessage(remove.error, FORBIDDEN) : null}
        onConfirm={(tx) => remove.mutate(tx)}
        onClose={closeDelete}
      />
    </section>
  );
}
