// Selo de vencimento das contas a pagar. A data vem da API; "hoje" é o dia de São Paulo
// (o mesmo fuso do servidor e de currentMonth), qualquer que seja o fuso do aparelho.

const SP_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Hoje em São Paulo como "aaaa-mm-dd". */
export function todayInSP(now: Date = new Date()): string {
  const parts = Object.fromEntries(SP_DAY.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Dias de calendário de `from` até `to` (negativo = `to` já passou). Datas "aaaa-mm-dd"; inválida -> null. */
function daysBetween(from: string, to: string): number | null {
  const a = ISO_DAY.exec(from);
  const b = ISO_DAY.exec(to);
  if (!a || !b) return null;
  const ms = Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3]);
  return Math.round(ms / 86_400_000);
}

export type DueTone = "late" | "soon" | "ok";
export interface DueBadge {
  label: string;
  tone: DueTone;
}

/** "Atrasada", "Vence hoje", "Vence amanhã" ou "Vence em N dias". Até 3 dias é "soon" (destaque). */
export function dueBadge(dueDate: string, now: Date = new Date()): DueBadge | null {
  const days = daysBetween(todayInSP(now), dueDate);
  if (days === null) return null;
  if (days < 0) return { label: "Atrasada", tone: "late" };
  if (days === 0) return { label: "Vence hoje", tone: "soon" };
  if (days === 1) return { label: "Vence amanhã", tone: "soon" };
  return { label: `Vence em ${days} dias`, tone: days <= 3 ? "soon" : "ok" };
}
