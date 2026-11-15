import { useId, useState, type FormEvent } from "react";
import { Button } from "../../ui";
import { accountOptionLabel, OWNER_LABEL, OWNERS, type Account, type Category, type Owner } from "../accounts/shared";
import {
  formToGoalBody,
  GOAL_TYPE_LABEL,
  GOAL_TYPES,
  PERIOD_LABEL,
  PERIODS,
  type GoalBody,
  type GoalFormErrors,
  type GoalFormValues,
  type GoalPeriod,
  type GoalType,
} from "./goalForm";

interface Props {
  initial: GoalFormValues;
  accounts: Account[];
  categories: Category[];
  submitLabel: string;
  editing?: boolean;
  busy?: boolean;
  serverError?: string | null;
  onSubmit: (body: GoalBody) => void;
  onCancel: () => void;
}

export function GoalForm({ initial, accounts, categories, submitLabel, editing = false, busy = false, serverError = null, onSubmit, onCancel }: Props) {
  const uid = useId();
  const [values, setValues] = useState<GoalFormValues>(initial);
  const [errors, setErrors] = useState<GoalFormErrors>({});

  const set = <K extends keyof GoalFormValues>(field: K, value: GoalFormValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const result = formToGoalBody(values);
    if ("errors" in result) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSubmit(result.body);
  };

  const id = (f: string) => `${uid}-${f}`;
  const err = (f: keyof GoalFormValues) =>
    errors[f] ? (
      <p id={id(`${f}-err`)} className="goal-err" role="alert">
        {errors[f]}
      </p>
    ) : null;
  const a11y = (f: keyof GoalFormValues) => (errors[f] ? { "aria-invalid": true, "aria-describedby": id(`${f}-err`) } : undefined);

  const { type } = values;
  const categoryKind = type === "income_period" ? "income" : "expense";
  const targetLabel =
    type === "income_period" ? "Meta (R$)" : type === "category_cap" ? "Teto mensal (R$)" : type === "debt_payoff" ? "Valor a quitar (R$, opcional)" : "Valor-alvo (R$)";

  return (
    <form className="goal-form" onSubmit={submit} noValidate aria-label={editing ? "Editar meta" : "Nova meta"}>
      <div className="goal-field">
        <label htmlFor={id("type")}>Tipo da meta</label>
        <select id={id("type")} value={type} onChange={(e) => set("type", e.target.value as GoalType)}>
          {GOAL_TYPES.map((t) => (
            <option key={t} value={t}>
              {GOAL_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="goal-field">
        <label htmlFor={id("name")}>Nome da meta</label>
        <input id={id("name")} autoComplete="off" value={values.name} onChange={(e) => set("name", e.target.value)} {...a11y("name")} />
        {err("name")}
      </div>

      {type === "debt_payoff" ? (
        <p className="goal-help">
          O progresso vem do saldo devedor das dívidas cadastradas: o nome da meta deve conter o nome da dívida (ex.: &quot;Quitar empréstimo&quot; para
          a dívida &quot;empréstimo&quot;). Deixe o valor em branco para usar o total da dívida.
        </p>
      ) : null}
      {type === "category_cap" ? (
        <p className="goal-help">O teto vale por mês e conta as despesas da categoria escolhida (e das subcategorias).</p>
      ) : null}

      <div className="goal-field">
        <label htmlFor={id("owner")}>Dono</label>
        <select id={id("owner")} value={values.owner} onChange={(e) => set("owner", e.target.value as Owner)}>
          {OWNERS.map((o) => (
            <option key={o} value={o}>
              {OWNER_LABEL[o]}
            </option>
          ))}
        </select>
      </div>

      {type === "income_period" ? (
        <>
          <div className="goal-field">
            <label htmlFor={id("period")}>Período</label>
            <select id={id("period")} value={values.period} onChange={(e) => set("period", e.target.value as GoalPeriod)}>
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {PERIOD_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="goal-field">
            <label htmlFor={id("floor")}>Piso (R$, opcional)</label>
            <input
              id={id("floor")}
              inputMode="decimal"
              autoComplete="off"
              placeholder="100,00"
              value={values.floor}
              onChange={(e) => set("floor", e.target.value)}
              {...a11y("floor")}
            />
            {err("floor")}
          </div>
        </>
      ) : null}

      <div className="goal-field">
        <label htmlFor={id("target")}>{targetLabel}</label>
        <input
          id={id("target")}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          value={values.target}
          onChange={(e) => set("target", e.target.value)}
          {...a11y("target")}
        />
        {err("target")}
      </div>

      {type === "income_period" ? (
        <div className="goal-field">
          <label htmlFor={id("challenge")}>Desafio (R$, opcional)</label>
          <input
            id={id("challenge")}
            inputMode="decimal"
            autoComplete="off"
            placeholder="160,00"
            value={values.challenge}
            onChange={(e) => set("challenge", e.target.value)}
            {...a11y("challenge")}
          />
          {err("challenge")}
        </div>
      ) : null}

      {type === "accumulate" ? (
        <div className="goal-field">
          <label htmlFor={id("account")}>Conta vinculada</label>
          <select id={id("account")} value={values.linkedAccountId} onChange={(e) => set("linkedAccountId", e.target.value)}>
            <option value="">Nenhuma (aportes manuais)</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {accountOptionLabel(a)}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {type === "income_period" || type === "category_cap" ? (
        <div className="goal-field">
          <label htmlFor={id("category")}>Categoria</label>
          <select
            id={id("category")}
            value={values.linkedCategoryId}
            onChange={(e) => set("linkedCategoryId", e.target.value)}
            {...a11y("linkedCategoryId")}
          >
            <option value="">Escolha a categoria</option>
            {categories
              .filter((c) => c.kind === categoryKind)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          {err("linkedCategoryId")}
        </div>
      ) : null}

      <div className="goal-field">
        <label htmlFor={id("due")}>Prazo (opcional)</label>
        <input id={id("due")} type="date" value={values.dueDate} onChange={(e) => set("dueDate", e.target.value)} {...a11y("dueDate")} />
        {err("dueDate")}
      </div>

      {editing ? (
        <label className="goal-check">
          <input type="checkbox" checked={values.active} onChange={(e) => set("active", e.target.checked)} />
          Meta ativa
        </label>
      ) : null}

      {serverError ? (
        <p className="goal-err" role="alert">
          {serverError}
        </p>
      ) : null}

      <div className="goal-actions">
        <Button type="submit" variant="primary" disabled={busy}>
          {submitLabel}
        </Button>
        <Button onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
