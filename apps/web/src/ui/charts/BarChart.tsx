import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Tone } from "../Card";
import { Money } from "../money";
import { ChartTooltip } from "./ChartTooltip";
import { toneColor } from "./palette";
import { ChartEmpty, ChartFigure, ChartLegend, useReducedMotion } from "./shared";
import "./charts.css";

export type BarDatum = {
  key: string;
  label: string;
  values: { name: string; cents: number; tone: Tone }[];
};

export type BarChartProps = { label: string; data: BarDatum[] };

export function BarChart({ label, data }: BarChartProps) {
  const reduced = useReducedMotion();

  if (!data.some((d) => d.values.some((v) => v.cents !== 0))) return <ChartEmpty />;

  // Séries = nomes distintos, na ordem em que aparecem; a cor vem do primeiro tom visto.
  const series: { name: string; tone: Tone }[] = [];
  for (const d of data) for (const v of d.values) if (!series.some((s) => s.name === v.name)) series.push({ name: v.name, tone: v.tone });

  const rows = data.map((d) => {
    const row: Record<string, number | string> = { key: d.key, label: d.label };
    series.forEach((s, i) => {
      const v = d.values.find((x) => x.name === s.name);
      if (v) row[`s${i}`] = v.cents;
    });
    return row;
  });

  return (
    <ChartFigure
      label={label}
      className="chart--bar"
      legend={<ChartLegend items={series.map((s, i) => ({ key: String(i), name: s.name, color: toneColor(s.tone) }))} />}
      table={
        <table className="visually-hidden">
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Período</th>
              {series.map((s, i) => (
                <th key={i} scope="col">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key}>
                <th scope="row">{d.label}</th>
                {series.map((s, i) => {
                  const v = d.values.find((x) => x.name === s.name);
                  return <td key={i}>{v ? <Money cents={v.cents} /> : null}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="chart__area" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <RBarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              stroke="var(--color-border)"
              tick={{ fill: "var(--color-muted)", fontSize: 12 }}
              tickLine={false}
              minTickGap={8}
            />
            {/* Eixo de valores escondido: com o olho ligado ele revelaria os números. O tooltip usa Money. */}
            <YAxis hide />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--color-surface-2)", opacity: 0.6 }} />
            {series.map((s, i) => (
              <Bar
                key={i}
                dataKey={`s${i}`}
                name={s.name}
                fill={toneColor(s.tone)}
                radius={[6, 6, 0, 0]}
                maxBarSize={36}
                isAnimationActive={!reduced}
              />
            ))}
          </RBarChart>
        </ResponsiveContainer>
      </div>
    </ChartFigure>
  );
}
