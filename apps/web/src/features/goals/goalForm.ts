import type { components } from "../../api/schema";
import { formatReaisShort } from "../accounts/money";
import type { Goal, Owner } from "../accounts/shared";
import { isValidIsoDate } from "../chat/dates";
import { centsToInput, parseBRL } from "../chat/money";

export type GoalBody = components["schemas"]["GoalCreate"];
export type GoalType = "accumulate" | "debt_payoff" | "income_period" | "category_cap";
export type GoalPeriod = "daily" | "weekly" | "monthly";

export const GOAL_TYPES: GoalType[] = ["accumulate", "debt_payoff", "income_period", "category_cap"];
export const GOAL_TYPE_LABEL: Record<GoalType, string> = {
  accumulate: "Acumular valor",
  debt_payoff: "Quitar dívida",
  income_period: "Receita por período",
  category_cap: "Teto de gasto por categoria",
};
export const PERIODS: GoalPeriod[] = ["daily", "weekly", "monthly"];
export const PERIOD_LABEL: Record<GoalPeriod, string> = { daily: "Diária", weekly: "Semanal", monthly: "Mensal" };

export const typeLabel = (type: string) => GOAL_TYPE_LABEL[type as GoalType] ?? type;

/** Valores do formulário de meta: tudo texto, como vem dos campos. */
export interface GoalFormValues {
  type: GoalType;
  name: string;
  owner: Owner;
  target: string; // Meta (income_period), teto (category_cap) ou valor-alvo
  dueDate: string;
  linkedAccountId: string;
  linkedCategoryId: string;
  period: GoalPeriod;
  floor: string; // nível Piso
  challenge: string; // nível Desafio
  active: boolean;
}

export type GoalFormErrors = Partial<Record<keyof GoalFormValues, string>>;

export function emptyGoalForm(owner: Owner): GoalFormValues {
  return {
    type: "accumulate",
    name: "",
    owner,
    target: "",
    dueDate: "",
    linkedAccountId: "",
    linkedCategoryId: "",
    period: "daily",
    floor: "",
    challenge: "",
    active: true,
  };
}

const idText = (id: number | null | undefined) => (id == null ? "" : String(id));
const levelCents = (goal: Goal, name: string) =>
  goal.levels?.find((l) => l.name.trim().toLowerCase() === name)?.target_cents;

export function goalToForm(goal: Goal): GoalFormValues {
  const floor = levelCents(goal, "piso");
  const challenge = levelCents(goal, "desafio");
  return {
    type: (GOAL_TYPES as string[]).includes(goal.type) ? (goal.type as GoalType) : "accumulate",
    name: goal.name,
    owner: goal.owner,
    target: goal.target_cents > 0 ? centsToInput(goal.target_cents) : "",
    dueDate: goal.due_date ?? "",
    linkedAccountId: idText(goal.linked_account_id),
    linkedCategoryId: idText(goal.linked_category_id),
    period: (PERIODS as string[]).includes(goal.period ?? "") ? (goal.period as GoalPeriod) : "daily",
    floor: floor == null ? "" : centsToInput(floor),
    challenge: challenge == null ? "" : centsToInput(challenge),
    active: goal.active,
  };
}

/** Texto do formulário -> corpo da API (tudo em centavos inteiros) ou erros por campo. */
export function formToGoalBody(v: GoalFormValues): { body: GoalBody } | { errors: GoalFormErrors } {
  const errors: GoalFormErrors = {};
  const name = v.name.trim();
  if (!name) errors.name = "Informe o nome da meta.";

  // Quitar dívida aceita alvo em branco (o servidor usa o valor total da dívida).
  const targetBlank = v.target.trim() === "";
  let target = 0;
  if (!(v.type === "debt_payoff" && targetBlank)) {
    const cents = parseBRL(v.target);
    if (cents === null) errors.target = "Informe um valor maior que zero, por exemplo 5.000,00.";
    else target = cents;
  }
  if (v.dueDate && !isValidIsoDate(v.dueDate)) errors.dueDate = "Informe uma data válida.";

  if (v.type === "income_period" || v.type === "category_cap") {
    if (!v.linkedCategoryId) {
      errors.linkedCategoryId = v.type === "category_cap" ? "Escolha a categoria do gasto." : "Escolha a categoria da receita.";
    }
  }

  let floor: number | null = null;
  let challenge: number | null = null;
  if (v.type === "income_period") {
    if (v.floor.trim()) {
      floor = parseBRL(v.floor);
      if (floor === null) errors.floor = "Informe um valor válido para o Piso.";
    }
    if (v.challenge.trim()) {
      challenge = parseBRL(v.challenge);
      if (challenge === null) errors.challenge = "Informe um valor válido para o Desafio.";
    }
    if (floor !== null && target > 0 && floor >= target) errors.floor = "O Piso deve ser menor que a Meta.";
    if (challenge !== null && target > 0 && challenge <= target) errors.challenge = "O Desafio deve ser maior que a Meta.";
  }

  if (Object.keys(errors).length > 0) return { errors };

  const levels =
    v.type === "income_period"
      ? [
          ...(floor !== null ? [{ name: "Piso", target_cents: floor }] : []),
          { name: "Meta", target_cents: target },
          ...(challenge !== null ? [{ name: "Desafio", target_cents: challenge }] : []),
        ]
      : null;

  return {
    body: {
      owner: v.owner,
      type: v.type,
      name,
      target_cents: target,
      period: v.type === "income_period" ? v.period : null,
      levels,
      due_date: v.dueDate || null,
      linked_account_id: v.type === "accumulate" && v.linkedAccountId ? Number(v.linkedAccountId) : null,
      linked_category_id:
        (v.type === "income_period" || v.type === "category_cap") && v.linkedCategoryId ? Number(v.linkedCategoryId) : null,
      active: v.active,
    },
  };
}

/** 24 -> "24"; 24,56 -> "24,5" (percentual vem pronto do servidor; só se corta a exibição). */
export function formatPercent(percent: number): string {
  // O servidor manda 2 casas: arredonda para o centésimo inteiro e corta para 1 casa, sem erro de float.
  const cut = Math.floor(Math.round(percent * 100) / 10) / 10;
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(cut);
}

/** "R$ 1.200 de R$ 5.000 · 24%". */
export function progressText(goal: Goal, money: (cents: number) => string = formatReaisShort): string {
  const p = goal.progress;
  return `${money(p.current_cents)} de ${money(p.target_cents)} · ${formatPercent(p.percent)}%`;
}
