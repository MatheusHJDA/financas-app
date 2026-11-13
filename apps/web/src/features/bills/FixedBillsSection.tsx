import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useId, useState } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { ConfirmBar } from "../accounts/ConfirmBar";
import { useAllAccounts, useAllCategories } from "../accounts/queries";
import { ApiError, OWNER_LABEL, assertOk, canWrite, errorMessage, type Account, type Category } from "../accounts/shared";
import { formatCents } from "../chat/money";
import { EmptyState, ErrorState, LoadingState } from "../../ui/States";
import { FixedBillForm } from "./FixedBillFields";
import {
  activeTotalCents,
  billToForm,
  currentMonth,
  emptyFixedBillForm,
  formatMonth,
  isEnded,
  monthOf,
  monthToFirstDay,
  sortBills,
  startsLater,
  type RecurringBill,
  type RecurringBillCreate,
  type RecurringBillUpdate,
} from "./fixedBillForm";
import "../accounts/ui.css";

export const RECURRING_BILLS_KEY = ["recurring-bills"] as const;
const AFTER_WRITE = ["recurring-bills", "bill-instances", "overview"];

async function loadRecurringBills(): Promise<RecurringBill[]> {
  const { data, response } = await api.GET("/recurring-bills", { params: { query: { limit: 200 } } });
  if (!data) throw new Error(`HTTP ${response.status}`);
  return data.items;
}

type Mode =
  | { kind: "new" }
  | { kind: "edit" | "end" | "reactivate" | "delete"; id: number }
  | null;

interface SaveInput {
  id: number | null;
  body: RecurringBillCreate | RecurringBillUpdate;
  notice: string;
}

/** Contas fixas (recorrentes): listar, criar, editar, encerrar/reativar e excluir. Só grava depois do toque. */
export function FixedBillsSection() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const bills = useQuery({ queryKey: RECURRING_BILLS_KEY, queryFn: loadRecurringBills });
  const accounts = useAllAccounts();
  const categories = useAllCategories();
  const [mode, setMode] = useState<Mode>(null);
  const [notice, setNotice] = useState("");

  const afterWrite = () => Promise.all(AFTER_WRITE.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));

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

  const open = (next: Mode) => {
    save.reset();
    remove.reset();
    setNotice("");
    setMode(next);
  };

  const refsReady = accounts.data !== undefined && categories.data !== undefined;
  const list = bills.data ? sortBills(bills.data) : [];
  const total = bills.data ? activeTotalCents(bills.data) : 0;

  return (
    <section className="u8-section" id="contas-fixas" aria-labelledby="fixed-bills-title">
      <h2 id="fixed-bills-title">Contas fixas</h2>
      <p className="u8-sr" role="status" aria-live="polite">
        {notice}
      </p>

      {bills.isLoading ? <LoadingState label="Carregando contas fixas…" /> : null}
      {bills.isError ? (
        <ErrorState message="Não foi possível carregar as contas fixas." onRetry={() => void bills.refetch()} />
      ) : null}

      {bills.data ? (
        <>
          {list.length === 0 && mode?.kind !== "new" ? (
            <EmptyState title="Nenhuma conta fixa" hint="Cadastre as contas que se repetem todo mês." />
          ) : (
            <>
              <p className="u8-row" style={{ marginTop: 0 }}>
                <span>Total mensal (inclui as que começam nos próximos meses)</span>
                <span className="u8-amount">{formatCents(total)}</span>
              </p>
              <ul className="u8-list">
                {list.map((bill) => (
                  <FixedBillItem
                    key={bill.id}
                    bill={bill}
                    accounts={accounts.data}
                    categories={categories.data}
                    refsReady={refsReady}
                    refsState={<RefsState accounts={accounts} categories={categories} />}
                    mode={mode && "id" in mode && mode.id === bill.id ? mode.kind : null}
                    save={save}
                    remove={remove}
                    onOpen={(kind) => open({ kind, id: bill.id })}
                    onClose={() => open(null)}
                  />
                ))}
              </ul>
            </>
          )}

          {mode?.kind === "new" ? (
            <div className="u8-card" style={{ marginTop: "var(--space-3)" }}>
              <h3>Nova conta fixa</h3>
              {accounts.data && categories.data ? (
                <FixedBillForm
                  initial={emptyFixedBillForm(me?.owner ?? "AMBOS")}
                  accounts={accounts.data}
                  categories={categories.data}
                  busy={save.isPending}
                  serverError={
                    save.isError
                      ? errorMessage(save.error, "Você não pode criar conta fixa para esse dono ou com essa conta bancária.")
                      : null
                  }
                  onSubmitCreate={(body) => save.mutate({ id: null, body, notice: `${body.name} criada.` })}
                  onCancel={() => open(null)}
                />
              ) : (
                <RefsState accounts={accounts} categories={categories} />
              )}
            </div>
          ) : (
            <div className="u8-actions" style={{ marginTop: "var(--space-3)" }}>
              <button type="button" className="u8-btn u8-btn--primary" onClick={() => open({ kind: "new" })}>
                Nova conta fixa
              </button>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

function RefsState({
  accounts,
  categories,
}: {
  accounts: ReturnType<typeof useAllAccounts>;
  categories: ReturnType<typeof useAllCategories>;
}) {
  if (accounts.isError || categories.isError) {
    return (
      <ErrorState
        message="Não foi possível carregar contas e categorias."
        onRetry={() => {
          void accounts.refetch();
          void categories.refetch();
        }}
      />
    );
  }
  return <LoadingState label="Carregando contas e categorias…" />;
}

interface ItemProps {
  bill: RecurringBill;
  accounts: Account[] | undefined;
  categories: Category[] | undefined;
  refsReady: boolean;
  /** Carregando ou erro (com "Tentar de novo") das contas/categorias. */
  refsState: ReactNode;
  mode: "edit" | "end" | "reactivate" | "delete" | null;
  save: {
    mutate: (input: SaveInput) => void;
    isPending: boolean;
    isError: boolean;
    error: unknown;
  };
  remove: {
    mutate: (bill: RecurringBill) => void;
    isPending: boolean;
    isError: boolean;
    error: unknown;
  };
  onOpen: (kind: "edit" | "end" | "reactivate" | "delete") => void;
  onClose: () => void;
}

const FORBIDDEN = "Você não pode alterar essa conta fixa.";

function FixedBillItem({
  bill,
  accounts,
  categories,
  refsReady,
  refsState,
  mode,
  save,
  remove,
  onOpen,
  onClose,
}: ItemProps) {
  const { me } = useAuth();
  const nameId = useId();
  const editable = canWrite(me, bill.owner);
  const ended = isEnded(bill);
  const account = bill.account_id == null ? null : (accounts?.find((a) => a.id === bill.account_id) ?? null);
  const category = bill.category_id == null ? null : (categories?.find((c) => c.id === bill.category_id) ?? null);

  const busy = mode === "delete" ? remove.isPending : save.isPending;
  const deleteConflict = mode === "delete" && remove.isError && remove.error instanceof ApiError && remove.error.status === 409;
  const saveError = mode !== null && mode !== "delete" && save.isError ? errorMessage(save.error, FORBIDDEN) : null;

  return (
    <li className="u8-card">
      <div className="u8-row">
        <div className="u8-grow">
          <strong id={nameId}>{bill.name}</strong>
          <p className="muted u8-small" style={{ margin: 0 }}>
            {OWNER_LABEL[bill.owner]} · vence dia {bill.due_day}
          </p>
        </div>
        <span className="u8-amount">{formatCents(bill.amount_cents)}</span>
      </div>
      <p className="muted u8-small" style={{ margin: "var(--space-1) 0 0" }}>
        {bill.account_id == null ? (
          <span className="u8-badge u8-badge--warn">Sem conta bancária</span>
        ) : (
          <>Conta: {account ? account.name : `nº ${bill.account_id}`}</>
        )}
        {" · "}
        {category ? category.name : "Sem categoria"}
        {bill.payment_method ? ` · ${bill.payment_method}` : ""}
      </p>
      {bill.account_id == null ? (
        <p className="u8-small" style={{ margin: "var(--space-1) 0 0" }}>
          Sem conta bancária, “Marcar como paga” não funciona.
        </p>
      ) : null}
      {startsLater(bill) ? (
        <p className="u8-small" style={{ margin: "var(--space-1) 0 0" }}>
          <span className="u8-badge">Começa em {formatMonth(bill.start_month)}</span>
        </p>
      ) : null}
      {bill.end_month ? (
        <p className="u8-small" style={{ margin: "var(--space-1) 0 0" }}>
          {ended ? (
            <span className="u8-badge">Encerrada em {formatMonth(bill.end_month)}</span>
          ) : (
            <>encerra em {formatMonth(bill.end_month)}</>
          )}
        </p>
      ) : null}

      {editable && mode === null ? (
        <div className="u8-actions" style={{ marginTop: "var(--space-2)" }}>
          <button type="button" className="u8-btn" aria-label={`Editar ${bill.name}`} onClick={() => onOpen("edit")}>
            Editar
          </button>
          {bill.end_month ? (
            <button type="button" className="u8-btn" aria-label={`Reativar ${bill.name}`} onClick={() => onOpen("reactivate")}>
              Reativar
            </button>
          ) : null}
          <button type="button" className="u8-btn" aria-label={`Encerrar ${bill.name}`} onClick={() => onOpen("end")}>
            {bill.end_month ? "Mudar mês final" : "Encerrar"}
          </button>
          <button
            type="button"
            className="u8-btn u8-btn--danger"
            aria-label={`Excluir ${bill.name}`}
            onClick={() => onOpen("delete")}
          >
            Excluir
          </button>
        </div>
      ) : null}

      {mode === "edit" ? (
        refsReady && accounts && categories ? (
          <FixedBillForm
            bill={bill}
            initial={billToForm(bill)}
            accounts={accounts}
            categories={categories}
            busy={busy}
            serverError={saveError}
            onSubmitEdit={(body) => {
              // Nada mudou: não há o que gravar.
              if (Object.keys(body).length === 0) onClose();
              else save.mutate({ id: bill.id, body, notice: `${bill.name} atualizada.` });
            }}
            onCancel={onClose}
          />
        ) : (
          <>
            {refsState}
            <button type="button" className="u8-btn" onClick={onClose}>
              Cancelar
            </button>
          </>
        )
      ) : null}

      {mode === "end" ? (
        <EndPanel bill={bill} busy={busy} error={saveError} onSave={save.mutate} onCancel={onClose} />
      ) : null}

      {mode === "reactivate" ? (
        <ConfirmBar
          message={`Reativar ${bill.name}? Ela volta a ser cobrada todo mês, sem mês final.`}
          confirmLabel="Sim, reativar"
          busy={busy}
          error={saveError}
          onConfirm={() => save.mutate({ id: bill.id, body: { end_month: null }, notice: `${bill.name} reativada.` })}
          onCancel={onClose}
        />
      ) : null}

      {mode === "delete" ? (
        <>
          <ConfirmBar
            message={`Excluir ${bill.name}? As contas a pagar em aberto dela somem.`}
            confirmLabel="Sim, excluir"
            danger
            busy={busy}
            error={remove.isError ? errorMessage(remove.error, FORBIDDEN) : null}
            retryable={!remove.isError || !(remove.error instanceof ApiError) || remove.error.status >= 500}
            onConfirm={() => remove.mutate(bill)}
            onCancel={onClose}
          />
          {deleteConflict ? (
            <div className="u8-actions" style={{ marginTop: "var(--space-2)" }}>
              <button type="button" className="u8-btn u8-btn--primary" aria-label={`Encerrar ${bill.name}`} onClick={() => onOpen("end")}>
                Encerrar
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

interface EndProps {
  bill: RecurringBill;
  busy: boolean;
  error: string | null;
  onSave: (input: SaveInput) => void;
  onCancel: () => void;
}

/** Último mês cobrado (mês/ano) + confirmação. Envia end_month = primeiro dia do mês. */
function EndPanel({ bill, busy, error, onSave, onCancel }: EndProps) {
  const uid = useId();
  const [month, setMonth] = useState(bill.end_month ? monthOf(bill.end_month) : currentMonth());
  const first = monthToFirstDay(month);
  const tooEarly = first !== null && first < bill.start_month;
  const problem = first === null ? "Informe o último mês, com mês e ano." : tooEarly ? `O último mês não pode ser anterior ao início (${formatMonth(bill.start_month)}).` : null;

  return (
    <div className="u8-form" style={{ marginTop: "var(--space-2)" }}>
      <div className="u8-field">
        <label htmlFor={`${uid}-end`}>Último mês cobrado</label>
        <input
          id={`${uid}-end`}
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          aria-invalid={problem ? true : undefined}
          aria-describedby={`${uid}-end-hint`}
        />
        <p id={`${uid}-end-hint`} className="muted u8-small" style={{ margin: 0 }}>
          As contas a pagar em aberto depois desse mês somem. As já pagas ficam.
        </p>
        {problem ? (
          <p className="u8-err" role="alert">
            {problem}
          </p>
        ) : null}
      </div>
      {first !== null && !problem ? (
        <ConfirmBar
          message={`Encerrar ${bill.name} em ${formatMonth(first)}?`}
          confirmLabel="Sim, encerrar"
          busy={busy}
          error={error}
          onConfirm={() => onSave({ id: bill.id, body: { end_month: first }, notice: `${bill.name} encerrada em ${formatMonth(first)}.` })}
          onCancel={onCancel}
        />
      ) : (
        <div className="u8-actions">
          <button type="button" className="u8-btn" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}
