import { CalendarOff, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useId, useState, type ReactNode } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Button, ErrorState, LoadingState, Money } from "../../ui";
import { ConfirmBar } from "../accounts/ConfirmBar";
import type { useAllAccounts, useAllCategories } from "../accounts/queries";
import { ApiError, OWNER_LABEL, canWrite, errorMessage, type Account, type Category } from "../accounts/shared";
import { FixedBillForm } from "./FixedBillFields";
import {
  billToForm,
  currentMonth,
  emptyFixedBillForm,
  formatMonth,
  isEnded,
  monthOf,
  monthToFirstDay,
  type RecurringBill,
  type RecurringBillCreate,
  type RecurringBillUpdate,
} from "./fixedBillForm";
import "../accounts/ui.css";
import "./bills.css";

export type SheetMode = { kind: "new" } | { kind: "view" | "edit" | "end" | "reactivate" | "delete"; id: number };

export interface SaveInput {
  id: number | null;
  body: RecurringBillCreate | RecurringBillUpdate;
  notice: string;
}

interface MutationState<T> {
  mutate: (input: T) => void;
  isPending: boolean;
  isError: boolean;
  error: unknown;
}

const FORBIDDEN = "Você não pode alterar essa conta fixa.";

export function sheetTitle(mode: SheetMode, bill: RecurringBill | null): string {
  switch (mode.kind) {
    case "new":
      return "Nova conta fixa";
    case "view":
      return bill?.name ?? "Conta fixa";
    case "edit":
      return "Editar conta fixa";
    case "end":
      return "Encerrar conta fixa";
    case "reactivate":
      return "Reativar conta fixa";
    case "delete":
      return "Excluir conta fixa";
  }
}

interface Props {
  mode: SheetMode;
  bill: RecurringBill | null;
  accounts: ReturnType<typeof useAllAccounts>;
  categories: ReturnType<typeof useAllCategories>;
  save: MutationState<SaveInput>;
  remove: MutationState<RecurringBill>;
  /** Troca o conteúdo do painel (ex.: do detalhe para o formulário). */
  go: (mode: SheetMode) => void;
  onClose: () => void;
}

/** Conteúdo do painel de uma conta fixa: detalhe com ações, formulário, encerrar, reativar ou excluir. */
export function FixedBillSheet({ mode, bill, accounts, categories, save, remove, go, onClose }: Props) {
  const { me } = useAuth();
  const refsReady = accounts.data !== undefined && categories.data !== undefined;
  const refsState = <RefsState accounts={accounts} categories={categories} />;
  const back = () => (bill ? go({ kind: "view", id: bill.id }) : onClose());

  if (mode.kind === "new") {
    return refsReady && accounts.data && categories.data ? (
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
        onCancel={onClose}
      />
    ) : (
      <>
        {refsState}
        <Button block onClick={onClose}>
          Cancelar
        </Button>
      </>
    );
  }
  if (!bill) return null;

  const busy = mode.kind === "delete" ? remove.isPending : save.isPending;
  const saveError = save.isError ? errorMessage(save.error, FORBIDDEN) : null;

  switch (mode.kind) {
    case "view":
      return (
        <BillDetail
          bill={bill}
          accounts={accounts.data}
          categories={categories.data}
          editable={canWrite(me, bill.owner)}
          go={go}
        />
      );

    case "edit":
      return refsReady && accounts.data && categories.data ? (
        <FixedBillForm
          bill={bill}
          initial={billToForm(bill)}
          accounts={accounts.data}
          categories={categories.data}
          busy={busy}
          serverError={saveError}
          onSubmitEdit={(body) => {
            // Nada mudou: não há o que gravar.
            if (Object.keys(body).length === 0) onClose();
            else save.mutate({ id: bill.id, body, notice: `${bill.name} atualizada.` });
          }}
          onCancel={back}
        />
      ) : (
        <>
          {refsState}
          <Button block onClick={back}>
            Cancelar
          </Button>
        </>
      );

    case "end":
      return <EndPanel bill={bill} busy={busy} error={saveError} onSave={save.mutate} onCancel={back} />;

    case "reactivate":
      return (
        <ConfirmBar
          message={`Reativar ${bill.name}? Ela volta a ser cobrada todo mês, sem mês final.`}
          confirmLabel="Sim, reativar"
          busy={busy}
          error={saveError}
          onConfirm={() => save.mutate({ id: bill.id, body: { end_month: null }, notice: `${bill.name} reativada.` })}
          onCancel={back}
        />
      );

    case "delete": {
      const conflict = remove.isError && remove.error instanceof ApiError && remove.error.status === 409;
      return (
        <>
          <ConfirmBar
            message={`Excluir ${bill.name}? As contas a pagar em aberto dela somem.`}
            confirmLabel="Sim, excluir"
            danger
            busy={busy}
            error={remove.isError ? errorMessage(remove.error, FORBIDDEN) : null}
            retryable={!remove.isError || !(remove.error instanceof ApiError) || remove.error.status >= 500}
            onConfirm={() => remove.mutate(bill)}
            onCancel={back}
          />
          {conflict ? (
            <div className="u8-actions" style={{ marginTop: "var(--space-2)" }}>
              <Button variant="primary" aria-label={`Encerrar ${bill.name}`} onClick={() => go({ kind: "end", id: bill.id })}>
                Encerrar
              </Button>
            </div>
          ) : null}
        </>
      );
    }
  }
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

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bill-dl__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

interface DetailProps {
  bill: RecurringBill;
  accounts: Account[] | undefined;
  categories: Category[] | undefined;
  editable: boolean;
  go: (mode: SheetMode) => void;
}

function BillDetail({ bill, accounts, categories, editable, go }: DetailProps) {
  const ended = isEnded(bill);
  const account = bill.account_id == null ? null : (accounts?.find((a) => a.id === bill.account_id) ?? null);
  const category = bill.category_id == null ? null : (categories?.find((c) => c.id === bill.category_id) ?? null);
  const open = (kind: "edit" | "end" | "reactivate" | "delete") => go({ kind, id: bill.id });

  let accountText: ReactNode;
  if (bill.account_id == null) accountText = <span className="bill-badge bill-badge--late">Sem conta bancária</span>;
  else if (account) accountText = account.name;
  else accountText = accounts ? `nº ${bill.account_id}` : "…";

  let categoryText: ReactNode;
  if (bill.category_id == null) categoryText = "Sem categoria";
  else if (category) categoryText = category.name;
  else categoryText = categories ? `nº ${bill.category_id}` : "…";

  return (
    <div className="bill-detail">
      <p className="bill-detail__amount">
        <Money cents={bill.amount_cents} /> <span className="bill-detail__per">por mês</span>
      </p>
      <dl className="bill-dl">
        <Row label="Vencimento">todo dia {bill.due_day}</Row>
        <Row label="Dono">{OWNER_LABEL[bill.owner]}</Row>
        <Row label="Conta bancária">{accountText}</Row>
        <Row label="Categoria">{categoryText}</Row>
        {bill.payment_method ? <Row label="Forma de pagamento">{bill.payment_method}</Row> : null}
        <Row label="Começa em">{formatMonth(bill.start_month)}</Row>
        {bill.end_month ? <Row label={ended ? "Encerrada em" : "Encerra em"}>{formatMonth(bill.end_month)}</Row> : null}
      </dl>
      {bill.account_id == null ? (
        <p className="bill-detail__warn">Sem conta bancária, “Marcar como paga” não funciona.</p>
      ) : null}

      {bill.debt_id != null ? (
        <div className="bill-actions">
          <Link to={`/dividas/${bill.debt_id}`} className="ui-btn ui-btn--primary">
            Ver empréstimo
          </Link>
        </div>
      ) : editable ? (
        <div className="bill-actions">
          <Button variant="primary" icon={Pencil} aria-label={`Editar ${bill.name}`} onClick={() => open("edit")}>
            Editar
          </Button>
          {bill.end_month ? (
            <Button icon={RotateCcw} aria-label={`Reativar ${bill.name}`} onClick={() => open("reactivate")}>
              Reativar
            </Button>
          ) : null}
          <Button icon={CalendarOff} aria-label={`Encerrar ${bill.name}`} onClick={() => open("end")}>
            {bill.end_month ? "Mudar mês final" : "Encerrar"}
          </Button>
          <Button variant="danger" icon={Trash2} aria-label={`Excluir ${bill.name}`} onClick={() => open("delete")}>
            Excluir
          </Button>
        </div>
      ) : (
        <p className="muted">Só o dono (ou o casal, nas contas de Ambos) altera esta conta fixa.</p>
      )}
    </div>
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
  const problem =
    first === null
      ? "Informe o último mês, com mês e ano."
      : tooEarly
        ? `O último mês não pode ser anterior ao início (${formatMonth(bill.start_month)}).`
        : null;

  return (
    <div className="u8-form">
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
          onConfirm={() =>
            onSave({ id: bill.id, body: { end_month: first }, notice: `${bill.name} encerrada em ${formatMonth(first)}.` })
          }
          onCancel={onCancel}
        />
      ) : (
        <div className="u8-actions">
          <Button onClick={onCancel}>Cancelar</Button>
        </div>
      )}
    </div>
  );
}
