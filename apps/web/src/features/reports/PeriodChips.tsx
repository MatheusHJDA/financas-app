import { CalendarDays } from "lucide-react";
import { Chip, ChipGroup, MonthSwitcher } from "../../ui";

export type Period = "current" | "previous" | "custom";

type Props = {
  period: Period;
  /** Mês exibido agora ("AAAA-MM"); no modo "Escolher mês" é o valor do seletor. */
  month: string;
  /** Mês corrente em São Paulo: o seletor não passa dele. */
  maxMonth: string;
  onPeriod(period: Period): void;
  onMonth(month: string): void;
};

/** Chips Esse mês / Mês passado / Escolher mês; o último abre o seletor de mês. */
export function PeriodChips({ period, month, maxMonth, onPeriod, onMonth }: Props) {
  return (
    <div className="rep-period">
      <ChipGroup label="Período">
        <Chip selected={period === "current"} onClick={() => onPeriod("current")}>
          Esse mês
        </Chip>
        <Chip selected={period === "previous"} onClick={() => onPeriod("previous")}>
          Mês passado
        </Chip>
        <Chip selected={period === "custom"} onClick={() => onPeriod("custom")} icon={CalendarDays}>
          Escolher mês
        </Chip>
      </ChipGroup>
      {period === "custom" ? <MonthSwitcher month={month} max={maxMonth} onChange={onMonth} /> : null}
    </div>
  );
}
