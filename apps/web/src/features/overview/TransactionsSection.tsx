import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { EmptyState, ErrorState, LoadingState } from "../../ui/States";
import { ConfirmBar } from "../accounts/ConfirmBar";
import { useAllAccounts, useAllCategories } from "../accounts/queries";
import {
  accountOptionLabel,
  assertOk,
  canWrite,
  errorMessage,
  OWNER_LABEL,
  type Owner,
  type Transaction,
} from "../accounts/shared";
import { formatDate } from "../chat/dates";
import { formatCents } from "../chat/money";
import { KIND_LABEL, KINDS, type Proposal, type TxKind } from "../chat/types";
import { EMPTY_FILTERS, exportHref, filtersToQuery, PAGE_SIZE, type TxFilters } from "./filters";
import { TxEditForm } from "./TxEditForm";
import "../accounts/ui.css";

const FORBIDDEN = "Você não pode alterar esse lançamento.";
const WRITE_PREFIXES = ["transactions", "overview", "accounts", "goals", "bill-instances"];
const OWNER_CHOICES: { value: Owner | ""; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "RUTH", label: "Ruth" },
  { value: "MATHEUS", label: "Matheus" },
  { value: "AMBOS", label: "Ambos" },
];

export function TransactionsSection() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const uid = useId();
  const accounts = useAllAccounts();
  const categories = useAllCategories();

  const [filters, setFilters] = useState<TxFilters>(EMPTY_FILTERS);
  const [qDraft, setQDraft] = useState("");
  const [page, setPage] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
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
      setEditingId(null);
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
      setDeletingId(null);
      setNotice("Lançamento excluído.");
      await afterWrite();
    },
  });

  const change = (patch: Partial<TxFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(0);
    setEditingId(null);
    setDeletingId(null);
  };
  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    change({ q: qDraft });
  };
  const clear = () => {
    setQDraft("");
    change(EMPTY_FILTERS);
  };

  const accountName = (id: number | null | undefined) => accounts.data?.find((a) => a.id === id)?.name ?? "";
  const categoryName = (id: number | null | undefined) => categories.data?.find((c) => c.id === id)?.name ?? "";

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE + items.length);
  const hasFilters = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  const id = (f: string) => `${uid}-${f}`;

  return (
    <section className="u8-section" aria-labelledby="tx-title">
      <h2 id="tx-title">Movimentações</h2>

      <div className="u8-card u8-filters" role="group" aria-label="Filtros">
        <div className="u8-form">
          <fieldset className="u8-field">
            <legend>Dono</legend>
            <div className="u8-seg">
              {OWNER_CHOICES.map((o) => (
                <label key={o.value || "todos"}>
                  <input
                    type="radio"
                    name={id("owner")}
                    value={o.value}
                    checked={filters.owner === o.value}
                    onChange={() => change({ owner: o.value })}
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="u8-field">
            <label htmlFor={id("account")}>Conta</label>
            <select id={id("account")} value={filters.accountId} onChange={(e) => change({ accountId: e.target.value })}>
              <option value="">Todas as contas</option>
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {accountOptionLabel(a)}
                </option>
              ))}
            </select>
          </div>

          <div className="u8-field">
            <label htmlFor={id("category")}>Categoria</label>
            <select id={id("category")} value={filters.categoryId} onChange={(e) => change({ categoryId: e.target.value })}>
              <option value="">Todas as categorias</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="u8-field">
            <label htmlFor={id("kind")}>Tipo</label>
            <select id={id("kind")} value={filters.kind} onChange={(e) => change({ kind: e.target.value as TxKind | "" })}>
              <option value="">Todos os tipos</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>

          <div className="u8-field">
            <label htmlFor={id("from")}>De (data)</label>
            <input id={id("from")} type="date" value={filters.dateFrom} onChange={(e) => change({ dateFrom: e.target.value })} />
          </div>
          <div className="u8-field">
            <label htmlFor={id("to")}>Até (data)</label>
            <input id={id("to")} type="date" value={filters.dateTo} onChange={(e) => change({ dateTo: e.target.value })} />
          </div>

          <form className="u8-field" role="search" onSubmit={submitSearch}>
            <label htmlFor={id("q")}>Buscar na descrição</label>
            <input
              id={id("q")}
              type="search"
              autoComplete="off"
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
            />
            <div className="u8-actions">
              <button type="submit" className="u8-btn">
                Buscar
              </button>
              {hasFilters || qDraft ? (
                <button type="button" className="u8-btn" onClick={clear}>
                  Limpar filtros
                </button>
              ) : null}
            </div>
          </form>
        </div>
      </div>

      <p className="u8-sr" role="status" aria-live="polite">
        {notice}
        {list.data ? ` ${total} ${total === 1 ? "lançamento" : "lançamentos"}.` : ""}
      </p>

      {list.isLoading ? <LoadingState label="Carregando movimentações…" /> : null}
      {list.isError ? <ErrorState message="Não foi possível carregar as movimentações." onRetry={() => void list.refetch()} /> : null}

      {list.data && items.length === 0 ? (
        <EmptyState
          title="Nenhuma movimentação"
          hint={hasFilters ? "Nada casa com esses filtros." : "Os lançamentos feitos pelo chat aparecem aqui."}
        />
      ) : null}

      {items.length > 0 ? (
        <ul className="u8-list" style={{ marginTop: "var(--space-3)" }}>
          {items.map((tx) => {
            const writable = canWrite(me, tx.owner);
            const sign = tx.kind === "expense" ? "−" : tx.kind === "income" ? "+" : "";
            const route =
              tx.kind === "transfer" ? `${accountName(tx.account_id)} → ${accountName(tx.to_account_id)}` : accountName(tx.account_id);
            return (
              <li key={tx.id} className="u8-card">
                <div className="u8-row">
                  <strong className="u8-grow">{tx.description}</strong>
                  <span className={`u8-amount ${tx.kind === "expense" ? "u8-neg" : tx.kind === "income" ? "u8-pos" : ""}`}>
                    {sign}
                    {formatCents(tx.amount_cents)}
                  </span>
                </div>
                <p className="muted u8-small" style={{ margin: 0 }}>
                  {[
                    formatDate(tx.date),
                    KIND_LABEL[tx.kind],
                    route,
                    categoryName(tx.category_id),
                    OWNER_LABEL[tx.owner],
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>

                {editingId === tx.id ? (
                  <TxEditForm
                    tx={tx}
                    accounts={accounts.data ?? []}
                    categories={categories.data ?? []}
                    busy={update.isPending}
                    serverError={update.isError ? errorMessage(update.error, FORBIDDEN) : null}
                    onSubmit={(body) => update.mutate({ tx, body })}
                    onCancel={() => {
                      update.reset();
                      setEditingId(null);
                    }}
                  />
                ) : null}

                {deletingId === tx.id ? (
                  <ConfirmBar
                    danger
                    message={`Excluir "${tx.description}" de ${formatCents(tx.amount_cents)}?`}
                    confirmLabel="Sim, excluir"
                    busy={remove.isPending}
                    error={remove.isError ? errorMessage(remove.error, FORBIDDEN) : null}
                    retryable={false}
                    onConfirm={() => remove.mutate(tx)}
                    onCancel={() => {
                      remove.reset();
                      setDeletingId(null);
                    }}
                  />
                ) : null}

                {writable && editingId !== tx.id && deletingId !== tx.id ? (
                  <div className="u8-actions" style={{ marginTop: "var(--space-2)" }}>
                    <button
                      type="button"
                      className="u8-btn"
                      aria-label={`Editar ${tx.description}`}
                      onClick={() => {
                        update.reset();
                        setNotice("");
                        setDeletingId(null);
                        setEditingId(tx.id);
                      }}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="u8-btn u8-btn--danger"
                      aria-label={`Excluir ${tx.description}`}
                      onClick={() => {
                        remove.reset();
                        setNotice("");
                        setEditingId(null);
                        setDeletingId(tx.id);
                      }}
                    >
                      Excluir
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {total > 0 ? (
        <nav className="u8-card" aria-label="Páginas de movimentações" style={{ marginTop: "var(--space-3)" }}>
          <p className="u8-small" style={{ margin: 0 }}>
            Mostrando {from}–{to} de {total}
          </p>
          <div className="u8-actions" style={{ marginTop: "var(--space-2)" }}>
            <button type="button" className="u8-btn" disabled={page === 0 || list.isFetching} onClick={() => setPage((p) => p - 1)}>
              Anterior
            </button>
            <button
              type="button"
              className="u8-btn"
              disabled={to >= total || list.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </button>
          </div>
        </nav>
      ) : null}

      <div className="u8-actions" style={{ marginTop: "var(--space-3)" }}>
        <a className="u8-btn" href={exportHref(filters)} download>
          Exportar CSV
        </a>
      </div>
    </section>
  );
}
