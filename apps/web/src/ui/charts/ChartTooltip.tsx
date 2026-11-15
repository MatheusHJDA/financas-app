import { Money } from "../money";

type Entry = {
  name?: string | number;
  value?: number | string | readonly (number | string)[];
  color?: string;
  payload?: { fill?: string; color?: string } & Record<string, unknown>;
};

export type ChartTooltipProps = {
  active?: boolean;
  payload?: readonly Entry[];
  label?: string | number;
  /** Formata o título do tooltip (ex.: x → "dia 12"). */
  formatLabel?: (label: string | number) => string;
};

/** Tooltip dos gráficos: valores sempre via `Money`, então o olho de ocultar vale aqui também. */
export function ChartTooltip({ active, payload, label, formatLabel }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const title = label === undefined || label === "" ? null : formatLabel ? formatLabel(label) : String(label);
  return (
    <div className="chart-tooltip" role="presentation">
      {title ? <p className="chart-tooltip__title">{title}</p> : null}
      <ul>
        {payload.map((e, i) => {
          const cents = typeof e.value === "number" ? e.value : Number(e.value);
          if (!Number.isFinite(cents)) return null;
          const color = e.payload?.fill ?? e.payload?.color ?? e.color;
          return (
            <li key={`${e.name}-${i}`}>
              <span className="chart-tooltip__dot" style={{ background: color }} aria-hidden="true" />
              <span className="chart-tooltip__name">{e.name}</span>
              <Money cents={cents} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
