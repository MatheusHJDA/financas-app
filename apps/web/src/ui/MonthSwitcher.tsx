import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "./Button";

const fmt = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

/** "2026-12" + delta meses -> "YYYY-MM". */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** "2026-12" -> "dezembro de 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return fmt.format(new Date(Date.UTC(y, m - 1, 1)));
}

type Props = { month: string; onChange(month: string): void; max?: string };

export function MonthSwitcher({ month, onChange, max }: Props) {
  const atMax = max !== undefined && month >= max;
  return (
    <div className="ui-month">
      <IconButton icon={ChevronLeft} label="Mês anterior" onClick={() => onChange(shiftMonth(month, -1))} />
      <span className="ui-month__label" aria-live="polite">
        {monthLabel(month)}
      </span>
      <IconButton
        icon={ChevronRight}
        label="Próximo mês"
        disabled={atMax}
        onClick={() => onChange(shiftMonth(month, 1))}
      />
    </div>
  );
}
