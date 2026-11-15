import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Gauge, Landmark, PiggyBank, TrendingUp, type LucideIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { Button, useHideValues } from "../../ui";
import { formatReaisShort } from "../accounts/money";
import { assertOk, canWrite, errorMessage, OWNER_LABEL, type Account, type Category, type Goal } from "../accounts/shared";
import { formatDate, isValidIsoDate, todayIso } from "../chat/dates";
import { parseBRL } from "../chat/money";
import { formatPercent, goalToForm, PERIOD_LABEL, progressText, typeLabel, type GoalBody, type GoalPeriod } from "./goalForm";
import { GoalForm } from "./GoalFormFields";
import "./goals.css";

const FORBIDDEN = "Você não pode alterar essa meta.";
type Mode = "view" | "edit" | "delete" | "entry";

// Ícone e cor da bolha por tipo de meta.
const TYPE_LOOK: Record<string, { icon: LucideIcon; tone: string }> = {
  accumulate: { icon: PiggyBank, tone: "" },
  income_period: { icon: TrendingUp, tone: "info" },
  category_cap: { icon: Gauge, tone: "warning" },
  debt_payoff: { icon: Landmark, tone: "expense" },
};

interface Props {
  goal: Goal;
  accounts: Account[];
  categories: Category[];
  onNotice: (text: string) => void;
}

export function GoalCard({ goal, accounts, categories, onNotice }: Props) {
  const { me } = useAuth();
  const { hidden } = useHideValues();
  const short = (cents: number) => (hidden ? "R$ •••••" : formatReaisShort(cents));
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
  const look = TYPE_LOOK[goal.type] ?? TYPE_LOOK.accumulate;
  const Icon = look.icon;
  const tone = over ? "expense" : look.tone;

  const open = (next: Mode) => {
    save.reset();
    remove.reset();
    entry.reset();
    onNotice("");
    setMode(next);
  };
  const close = () => open("view");

  return (
    <li className="goal-card" aria-labelledby={titleId}>
      <div className="goal-card__top">
        <span className={`goal-card__bubble${tone ? ` goal-card__bubble--${tone}` : ""}`} aria-hidden="true">
          <Icon size={22} strokeWidth={1.75} />
        </span>
        <div className="goal-card__titles">
          <h2 id={titleId} className="goal-card__title">
            {goal.name}
          </h2>
          <p className="goal-card__meta">
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
        </div>
        {!goal.active ? <span className="goal-badge">Inativa</span> : null}
      </div>

      <div
        className={`goal-bar${over ? " goal-bar--over" : ""}`}
        role="progressbar"
        aria-label={`Progresso de ${goal.name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(width)}
        aria-valuetext={progressText(goal, short)}
      >
        <div className="goal-bar__fill" style={{ width: `${width}%` }} />
      </div>
      <p className="goal-amount">{progressText(goal, short)}</p>

      {over ? (
        <p className="goal-alert" role="status">
          Acima do teto em {short(p.current_cents - p.target_cents)}.
        </p>
      ) : null}
      {goal.type === "category_cap" && !over ? <p className="goal-note">Gasto do mês na categoria.</p> : null}
      {goal.type === "debt_payoff" ? <p className="goal-note">Quanto da dívida já foi quitado.</p> : null}
      {goal.type === "accumulate" && !manualEntries ? (
        <p className="goal-note">O progresso vem do saldo da conta vinculada.</p>
      ) : null}

      {levels.length > 0 ? (
        <>
          <ul className="goal-levels" aria-label="Níveis">
            {levels.map((l) => {
              const reached = p.current_cents >= l.target_cents;
              return (
                <li key={`${l.name}-${l.target_cents}`} className={`goal-level${reached ? " goal-level--on" : ""}`}>
                  <span>
                    {reached ? "✓ " : ""}
                    {l.name}
                    {reached ? <span className="visually-hidden"> (atingido)</span> : null}
                  </span>
                  <span className="goal-level__amount">{short(l.target_cents)}</span>
                </li>
              );
            })}
          </ul>
          <p className="goal-note">{p.level ? `Nível atingido: ${p.level}` : "Nenhum nível atingido ainda."}</p>
        </>
      ) : null}
      {goal.type === "income_period" && levels.length === 0 ? (
        <p className="goal-note">Percentual da meta: {formatPercent(p.percent)}%.</p>
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
        <DeleteConfirm
          name={goal.name}
          busy={remove.isPending}
          error={remove.isError ? errorMessage(remove.error, FORBIDDEN) : null}
          onConfirm={() => remove.mutate()}
          onCancel={close}
        />
      ) : null}

      {writable && mode === "view" ? (
        <div className="goal-actions">
          {manualEntries ? (
            <Button variant="primary" aria-label={`Registrar aporte em ${goal.name}`} onClick={() => open("entry")}>
              Aportar
            </Button>
          ) : null}
          <Button aria-label={`Editar meta ${goal.name}`} onClick={() => open("edit")}>
            Editar
          </Button>
          <Button variant="danger" aria-label={`Excluir meta ${goal.name}`} onClick={() => open("delete")}>
            Excluir
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** Confirmação em linha: nada é apagado até o toque em "Sim, excluir". */
function DeleteConfirm({
  name,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  name: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  return (
    <div className="goal-confirm" role="alertdialog" aria-labelledby={id}>
      <p id={id}>
        <strong>{`Excluir a meta "${name}"?`}</strong>
      </p>
      {error ? (
        <p className="goal-err" role="alert">
          {error}
        </p>
      ) : null}
      <div className="goal-actions">
        {!error ? (
          <Button variant="danger" disabled={busy} onClick={onConfirm}>
            Sim, excluir
          </Button>
        ) : null}
        <Button disabled={busy} onClick={onCancel}>
          {error ? "Fechar" : "Cancelar"}
        </Button>
      </div>
    </div>
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
    <form className="goal-form" onSubmit={submit} noValidate aria-label="Registrar aporte">
      <div className="goal-field">
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
          <p id={`${uid}-amount-err`} className="goal-err" role="alert">
            {errors.amount}
          </p>
        ) : null}
      </div>
      <div className="goal-field">
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
          <p id={`${uid}-date-err`} className="goal-err" role="alert">
            {errors.date}
          </p>
        ) : null}
      </div>
      {serverError ? (
        <p className="goal-err" role="alert">
          {serverError}
        </p>
      ) : null}
      <div className="goal-actions">
        <Button type="submit" variant="primary" disabled={busy}>
          Registrar aporte
        </Button>
        <Button onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
