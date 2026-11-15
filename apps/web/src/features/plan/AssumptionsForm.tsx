import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../ui";
import { PLANILHA_DEFAULTS } from "./planDefaults";
import { PLAN_KEY, PlanError, saveAssumptions, type PlanAssumptions } from "./planApi";
import { fromForm, MAX_CARDS, toForm, type CardRow, type FieldErrors, type PlanForm } from "./planForm";

type TextKey = Exclude<keyof PlanForm, "cards">;

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  inputMode?: "decimal" | "numeric" | "text";
  type?: "text" | "month";
}

function TextField({ id, label, value, onChange, error, inputMode = "decimal", type = "text" }: FieldProps) {
  const errorId = `${id}-erro`;
  return (
    <div className="plan-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        inputMode={type === "month" ? undefined : inputMode}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error ? (
        <p id={errorId} className="plan-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface Props {
  assumptions: PlanAssumptions;
  onDone: () => void;
}

// "Editar premissas": todos os campos da API; valores em R$ (vírgula) e taxa em % ao mês.
export function AssumptionsForm({ assumptions, onDone }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PlanForm>(() => toForm(assumptions));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirmReset, setConfirmReset] = useState(false);

  const save = useMutation({
    mutationFn: saveAssumptions,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PLAN_KEY });
      onDone();
    },
  });

  const reset = useMutation({
    mutationFn: () => saveAssumptions(PLANILHA_DEFAULTS),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PLAN_KEY });
      setForm(toForm(PLANILHA_DEFAULTS));
      setErrors({});
      setConfirmReset(false);
    },
  });

  const setText = (key: TextKey, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const setCard = (index: number, patch: Partial<CardRow>) =>
    setForm((prev) => ({
      ...prev,
      cards: prev.cards.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  const addCard = () =>
    setForm((prev) =>
      prev.cards.length >= MAX_CARDS
        ? prev
        : {
            ...prev,
            cards: [...prev.cards, { name: "", installment: "", count: "1", firstMonth: "1" }],
          },
    );
  const removeCard = (index: number) =>
    setForm((prev) => ({ ...prev, cards: prev.cards.filter((_, i) => i !== index) }));

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = fromForm(form);
    if ("errors" in result) {
      setErrors(result.errors);
      const first = Object.keys(result.errors)[0];
      if (first) document.getElementById(`plan-${first.replace(/\./g, "-")}`)?.focus();
      return;
    }
    setErrors({});
    save.mutate(result.value);
  }

  const field = (key: TextKey, label: string, inputMode: FieldProps["inputMode"] = "decimal") => (
    <TextField
      id={`plan-${key}`}
      label={label}
      value={form[key]}
      onChange={(v) => setText(key, v)}
      error={errors[key]}
      inputMode={inputMode}
    />
  );

  const saveMessage =
    save.error instanceof PlanError && save.error.status === 422
      ? "A API recusou algum valor. Confira os campos destacados."
      : "Não foi possível salvar. Tente de novo.";

  return (
    <form className="plan-form" onSubmit={onSubmit} noValidate aria-label="Premissas do plano">
      <fieldset>
        <legend>Período</legend>
        {/* type=month: o valor é AAAA-MM; ver planForm.ts */}
        <TextField
          id="plan-startMonth"
          type="month"
          label="Primeiro mês da projeção"
          value={form.startMonth}
          onChange={(v) => setText("startMonth", v)}
          error={errors.startMonth}
        />
        {field("months", "Meses projetados", "numeric")}
      </fieldset>

      <fieldset>
        <legend>Entradas por mês</legend>
        {field("salary", "Salário líquido da Ruth (R$)")}
        {field("otherIncome", "Outras receitas fixas, IPTV líquido (R$)")}
        {field("uberMonthly", "Uber/99 bruto esperado no mês (R$)")}
        {field("uberFuelPercent", "Parte do Uber gasta com combustível (%)", "numeric")}
      </fieldset>

      <fieldset>
        <legend>Saídas por mês</legend>
        {field("fixedBills", "Contas fixas mensais (R$)")}
        {field("dailyExpenses", "Dia a dia: mercado, combustível pessoal, farmácia (R$)")}
        {field("contingency", "Imprevistos e Pix diversos (R$)")}
        {field("healthPlan", "Plano de saúde, entra depois da quitação (R$)")}
      </fieldset>

      <fieldset>
        <legend>Parcelas de cartão</legend>
        {errors.cards ? (
          <p className="plan-field-error" role="alert">
            {errors.cards}
          </p>
        ) : null}
        {form.cards.map((row, i) => (
          <fieldset key={i} className="plan-card-row">
            <legend>Parcela {i + 1}</legend>
            <TextField
              id={`plan-cards-${i}-name`}
              label="Nome"
              value={row.name}
              onChange={(v) => setCard(i, { name: v })}
              error={errors[`cards.${i}.name`]}
              inputMode="text"
            />
            <TextField
              id={`plan-cards-${i}-installment`}
              label="Valor de cada parcela (R$)"
              value={row.installment}
              onChange={(v) => setCard(i, { installment: v })}
              error={errors[`cards.${i}.installment`]}
            />
            <TextField
              id={`plan-cards-${i}-count`}
              label="Parcelas restantes"
              value={row.count}
              onChange={(v) => setCard(i, { count: v })}
              error={errors[`cards.${i}.count`]}
              inputMode="numeric"
            />
            <TextField
              id={`plan-cards-${i}-firstMonth`}
              label="Mês da 1ª parcela (1 = mês inicial)"
              value={row.firstMonth}
              onChange={(v) => setCard(i, { firstMonth: v })}
              error={errors[`cards.${i}.firstMonth`]}
              inputMode="numeric"
            />
            <Button block onClick={() => removeCard(i)}>
              Remover parcela {i + 1}
            </Button>
          </fieldset>
        ))}
        <Button block onClick={addCard} disabled={form.cards.length >= MAX_CARDS}>
          Adicionar parcela de cartão
        </Button>
      </fieldset>

      <fieldset>
        <legend>Empréstimo</legend>
        {field("loanPrincipal", "Valor contratado (R$)")}
        {field("loanRatePercent", "Juros ao mês (%)")}
        {field("loanInstallments", "Número de parcelas", "numeric")}
        {field("loanBalance", "Saldo devedor hoje (R$)")}
      </fieldset>

      <fieldset>
        <legend>Caixa e reserva</legend>
        {field("cashNow", "Saldo em conta hoje (R$)")}
        {field("upfrontPayments", "Saídas imediatas, fatura já fechada (R$)")}
        {field("initialAmortization", "Amortização inicial (R$)")}
        {field("reserveMinimum", "Reserva mínima, nunca amortizar abaixo disso (R$)")}
      </fieldset>

      {save.isError ? (
        <p className="plan-field-error" role="alert">
          {saveMessage}
        </p>
      ) : null}
      <div className="plan-form-actions">
        <Button type="submit" variant="primary" block disabled={save.isPending || reset.isPending}>
          {save.isPending ? "Salvando…" : "Salvar premissas"}
        </Button>
        <Button block onClick={onDone} disabled={save.isPending}>
          Cancelar
        </Button>
      </div>

      <div className="plan-reset">
        {confirmReset ? (
          <div role="group" aria-label="Confirmação" className="plan-confirm">
            <p>
              Isso troca todas as premissas pelos valores da planilha. Quer continuar?
            </p>
            <Button variant="danger" block onClick={() => reset.mutate()} disabled={reset.isPending}>
              {reset.isPending ? "Voltando…" : "Sim, voltar aos valores da planilha"}
            </Button>
            <Button block onClick={() => setConfirmReset(false)}>
              Não, manter as premissas atuais
            </Button>
          </div>
        ) : (
          <Button variant="danger" block onClick={() => setConfirmReset(true)}>
            Voltar aos valores da planilha
          </Button>
        )}
        {reset.isError ? (
          <p className="plan-field-error" role="alert">
            Não foi possível voltar aos valores da planilha. Tente de novo.
          </p>
        ) : null}
      </div>
    </form>
  );
}
