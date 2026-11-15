import {
  CartesianGrid,
  Line,
  LineChart as RLineChart,
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

export type LineSeries = {
  name: string;
  points: { x: number; cents: number }[];
  /** Série tracejada, ex.: "mês passado". */
  dashed?: boolean;
  tone: Tone;
};

export type LineChartProps = {
  label: string;
  series: LineSeries[];
  xLabel?(x: number): string;
};

export function LineChart({ label, series, xLabel }: LineChartProps) {
  const reduced = useReducedMotion();
  const fmtX = (x: number | string) => (xLabel ? xLabel(Number(x)) : String(x));

  const hasData = series.some((s) => s.points.some((p) => p.cents !== 0));
  if (!hasData) return <ChartEmpty />;

  // Uma linha por x (união dos x de todas as séries); série mais curta fica vazia nos x que não tem.
  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
  const byX = series.map((s) => new Map(s.points.map((p) => [p.x, p.cents])));
  const rows = xs.map((x) => {
    const row: Record<string, number> = { x };
    byX.forEach((m, i) => {
      const v = m.get(x);
      if (v !== undefined) row[`s${i}`] = v;
    });
    return row;
  });

  return (
    <ChartFigure
      label={label}
      className="chart--line"
      legend={
        <ChartLegend
          items={series.map((s, i) => ({ key: String(i), name: s.name, color: toneColor(s.tone), dashed: s.dashed }))}
        />
      }
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
            {xs.map((x) => (
              <tr key={x}>
                <th scope="row">{fmtX(x)}</th>
                {series.map((_, i) => {
                  const v = byX[i].get(x);
                  return <td key={i}>{v === undefined ? null : <Money cents={v} />}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="chart__area" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <RLineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="x"
              tickFormatter={fmtX}
              stroke="var(--color-border)"
              tick={{ fill: "var(--color-muted)", fontSize: 12 }}
              tickLine={false}
              minTickGap={16}
            />
            {/* Eixo de valores escondido: com o olho ligado ele revelaria os números. O tooltip usa Money. */}
            <YAxis hide />
            <Tooltip content={<ChartTooltip formatLabel={(l) => fmtX(l)} />} />
            {series.map((s, i) => (
              <Line
                key={i}
                type="monotone"
                dataKey={`s${i}`}
                name={s.name}
                stroke={toneColor(s.tone)}
                strokeWidth={2.5}
                strokeDasharray={s.dashed ? "6 4" : undefined}
                dot={s.points.length === 1 ? { r: 3 } : false /* um ponto só (dia 1) não desenha linha */}
                activeDot={{ r: 4 }}
                connectNulls
                isAnimationActive={!reduced}
              />
            ))}
          </RLineChart>
        </ResponsiveContainer>
      </div>
    </ChartFigure>
  );
}
