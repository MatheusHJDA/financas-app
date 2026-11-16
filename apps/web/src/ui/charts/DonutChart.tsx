import type { ReactNode } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Money } from "../money";
import { ChartTooltip } from "./ChartTooltip";
import { categoryColor } from "./palette";
import {
  ChartEmpty,
  ChartFigure,
  ChartLegend,
  useReducedMotion,
} from "./shared";
import "./charts.css";

export type DonutDatum = { key: string; name: string; cents: number };

export type DonutChartProps = {
  label: string;
  /** Já ordenado pelo chamador: a cor de cada fatia vem do índice (estável entre telas). */
  data: DonutDatum[];
  centerLabel?: ReactNode;
  /** Legenda visual com os nomes. Padrão: ligada. */
  legend?: boolean;
};

export function DonutChart({
  label,
  data,
  centerLabel,
  legend = true,
}: DonutChartProps) {
  const reduced = useReducedMotion();
  const slices = data.filter((d) => d.cents > 0);
  if (slices.length === 0) return <ChartEmpty />;

  const items = data
    .map((d, i) => ({ ...d, color: categoryColor(i) }))
    .filter((d) => d.cents > 0);

  return (
    <ChartFigure
      label={label}
      className="chart--donut"
      legend={
        legend ? (
          <ChartLegend
            items={items.map((d) => ({
              key: d.key,
              name: d.name,
              color: d.color,
            }))}
          />
        ) : null
      }
      table={
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Categoria</th>
              <th scope="col">Valor</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key}>
                <th scope="row">{d.name}</th>
                <td>
                  <Money cents={d.cents} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="chart__area chart__area--donut">
        <div className="chart__svg" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <PieChart>
              <Pie
                data={items}
                dataKey="cents"
                nameKey="name"
                innerRadius="62%"
                outerRadius="100%"
                paddingAngle={items.length > 1 ? 2 : 0}
                stroke="var(--color-surface)"
                strokeWidth={2}
                isAnimationActive={!reduced}
              >
                {items.map((d) => (
                  <Cell key={d.key} fill={d.color} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        {centerLabel ? (
          <div className="chart__center">{centerLabel}</div>
        ) : null}
      </div>
    </ChartFigure>
  );
}
