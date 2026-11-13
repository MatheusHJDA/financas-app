import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { ConfirmBar } from "../accounts/ConfirmBar";
import { formatReaisShort } from "../accounts/money";
import { assertOk, canWrite, errorMessage, OWNER_LABEL, type Account, type Category, type Goal } from "../accounts/shared";
import { formatDate, isValidIsoDate, todayIso } from "../chat/dates";
import { parseBRL } from "../chat/money";
import { formatPercent, goalToForm, PERIOD_LABEL, progressText, typeLabel, type GoalBody, type GoalPeriod } from "./goalForm";
import { GoalForm } from "./GoalFormFields";
import "../accounts/ui.css";

const FORBIDDEN = "Você não pode alterar essa meta.";
type Mode = "view" | "edit" | "delete" | "entry";

interface Props {
  goal: Goal;
  accounts: Account[];
  categories: Category[];
  onNotice: (text: string) => void;
}

export function GoalCard({ goal, accounts, categories, onNotice }: Props) {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const titleId = useId();
  const [mode, setMode] = useState<Mode>("view");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["goals"] });
  const done = async (text: string) => {
    setMode("view");
    onNotice(text);
    await refresh();
  };

  const save = useMutation({
    mutationFn: async (body: GoalBody) => {
      const { response, error } = await api.PATCH("/goals/{id}", { params: { path: { id: goal.id } }, body });
      assertOk(response, error);
    },
    onSuccess: () => done("Meta atualizada."),
  });
  const remove = useMutation({
    mutationFn: async () => {
      const { response, error } = await api.DELETE("/goals/{id}", { params: { path: { id: goal.id } } });
      assertOk(response, error);
    },
    onSuccess: () => done("Meta excluída."),
  });
  const entry = useMutation({
    mutationFn: async (body: { amount_cents: number; date: string }) => {
      const { response, error } = await api.POST("/goals/{id}/entries", { params: { path: { id: goal.id } }, body });
      assertOk(response, error);
    },
    onSuccess: () => done("Aporte registrado."),
  });

  const writable = canWrite(me, goal.owner);
  const p = goal.progress;
  const over = goal.type === "category_cap" && p.current_cents > p.target_cents;
  const width = Math.max(0, Math.min(100, p.percent));
  const manualEntries = goal.type === "accumulate" && goal.linked_account_id == null;
  const categoryName = categories.find((c) => c.id === goal.linked_category_id)?.name;
  const accountName = accounts.find((a) => a.id === goal.linked_account_id)?.name;
  const levels = [...(goal.levels ?? [])].sort((a, b) => a.target_cents - b.target_cents);

  const open = (next: Mode) => {
    save.reset();
    remove.reset();
    entry.reset();
    onNotice("");
    setMode(next);
  };
  const close = () => open("view");

  return (
    <li className="u8-card" aria-labelledby={titleId}>
      <div className="u8-row">
        <h3 id={titleId} className="u8-grow">
          {goal.name}
        </h3>
        {!goal.active ? <span className="u8-badge">Inativa</span> : null}
      </div>
      <p className="muted u8-small" style={{ margin: "var(--space-1) 0 var(--space-2)" }}>
        {[
          typeLabel(goal.type),
          OWNER_LABEL[goal.owner],
          goal.type === "income_period" && goal.period ? (PERIOD_LABEL[goal.period as GoalPeriod] ?? goal.period) : "",
          categoryName ?? "",
          accountName ? `Conta ${accountName}` : "",
          goal.due_date ? `Prazo ${formatDate(goal.due_date)}` : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      <div
        className={`u8-bar ${over ? "u8-bar--over" : ""}`}
        role="progressbar"
        aria-label={`Progresso de ${goal.name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(width)}
        aria-valuetext={progressText(goal)}
      >
        <div className="u8-bar-fill" style={{ width: `${width}%` }} />
      </div>
      <p className="u8-amount" style={{ margin: "var(--space-2) 0 0", whiteSpace: "normal" }}>
        {progressText(goal)}
      </p>

      {over ? (
        <p className="u8-err" role="status">
          Acima do teto em {formatReaisShort(p.current_cents - p.target_cents)}.
        </p>
      ) : null}
      {goal.type === "category_cap" && !over ? <p className="muted u8-small">Gasto do mês na categoria.</p> : null}
      {goal.type === "debt_payoff" ? <p className="muted u8-small">Quanto da dívida já foi quitado.</p> : null}
      {goal.type === "accumulate" && !manualEntries ? (
        <p className="muted u8-small">O progresso vem do saldo da conta vinculada.</p>
      ) : null}

      {levels.length > 0 ? (
        <>
          <ul className="u8-list" aria-label="Níveis" style={{ marginTop: "var(--space-2)" }}>
            {levels.map((l) => {
              const reached = p.current_cents >= l.target_cents;
              return (
                <li key={`${l.name}-${l.target_cents}`} className="u8-row">
                  <span>
                    {reached ? "✓ " : ""}
                    {l.name}
                    {reached ? <span className="u8-sr"> (atingido)</span> : null}
                  </span>
                  <span className="u8-amount">{formatReaisShort(l.target_cents)}</span>
                </li>
              );
            })}
          </ul>
          <p className="u8-small" style={{ margin: "var(--space-2) 0 0" }}>
            {p.level ? `Nível atingido: ${p.level}` : "Nenhum nível atingido ainda."}
          </p>
        </>
      ) : null}
      {goal.type === "income_period" && levels.length === 0 ? (
        <p className="muted u8-small">Percentual da meta: {formatPercent(p.percent)}%.</p>
      ) : null}

      {mode === "edit" ? (
        <GoalForm
          editing
          initial={goalToForm(goal)}
          accounts={accounts}
          categories={categories}
          submitLabel="Salvar meta"
          busy={save.isPending}
          serverError={save.isError ? errorMessage(save.error, FORBIDDEN) : null}
          onSubmit={(body) => save.mutate(body)}
          onCancel={close}
        />
      ) : null}

      {mode === "entry" ? (
        <EntryForm
          busy={entry.isPending}
          serverError={entry.isError ? errorMessage(entry.error, FORBIDDEN) : null}
          onSubmit={(body) => entry.mutate(body)}
          onCancel={close}
        />
      ) : null}

      {mode === "delete" ? (
        <ConfirmBar
          danger
          message={`Excluir a meta "${goal.name}"?`}
          confirmLabel="Sim, excluir"
          busy={remove.isPending}
          error={remove.isError ? errorMessage(remove.error, FORBIDDEN) : null}
          retryable={false}
          onConfirm={() => remove.mutate()}
          onCancel={close}
        />
      ) : null}

      {writable && mode === "view" ? (
        <div className="u8-actions" style={{ marginTop: "var(--space-2)" }}>
          {manualEntries ? (
            <button type="button" className="u8-btn u8-btn--primary" aria-label={`Registrar aporte em ${goal.name}`} onClick={() => open("entry")}>
              Aportar
            </button>
          ) : null}
          <button type="button" className="u8-btn" aria-label={`Editar meta ${goal.name}`} onClick={() => open("edit")}>
            Editar
          </button>
          <button type="button" className="u8-btn u8-btn--danger" aria-label={`Excluir meta ${goal.name}`} onClick={() => open("delete")}>
            Excluir
          </button>
        </div>
      ) : null}
    </li>
  );
}

function EntryForm({
  busy,
  serverError,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  serverError: string | null;
  onSubmit: (body: { amount_cents: number; date: string }) => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [errors, setErrors] = useState<{ amount?: string; date?: string }>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const cents = parseBRL(amount);
    const next: { amount?: string; date?: string } = {};
    if (cents === null) next.amount = "Informe um valor maior que zero, por exemplo 200,00.";
    if (!isValidIsoDate(date)) next.date = "Informe uma data válida.";
    setErrors(next);
    if (cents === null || next.date) return;
    onSubmit({ amount_cents: cents, date });
  };

  return (
    <form className="u8-form" onSubmit={submit} noValidate aria-label="Registrar aporte" style={{ marginTop: "var(--space-2)" }}>
      <div className="u8-field">
        <label htmlFor={`${uid}-amount`}>Valor do aporte (R$)</label>
        <input
          id={`${uid}-amount`}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setErrors((prev) => ({ ...prev, amount: undefined }));
          }}
          aria-invalid={errors.amount ? true : undefined}
          aria-describedby={errors.amount ? `${uid}-amount-err` : undefined}
        />
        {errors.amount ? (
          <p id={`${uid}-amount-err`} className="u8-err" role="alert">
            {errors.amount}
          </p>
        ) : null}
      </div>
      <div className="u8-field">
        <label htmlFor={`${uid}-date`}>Data do aporte</label>
        <input
          id={`${uid}-date`}
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setErrors((prev) => ({ ...prev, date: undefined }));
          }}
          aria-invalid={errors.date ? true : undefined}
          aria-describedby={errors.date ? `${uid}-date-err` : undefined}
        />
        {errors.date ? (
          <p id={`${uid}-date-err`} className="u8-err" role="alert">
            {errors.date}
          </p>
        ) : null}
      </div>
      {serverError ? (
        <p className="u8-err" role="alert">
          {serverError}
        </p>
      ) : null}
      <div className="u8-actions">
        <button type="submit" className="u8-btn u8-btn--primary" disabled={busy}>
          Registrar aporte
        </button>
        <button type="button" className="u8-btn" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
