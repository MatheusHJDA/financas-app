import type { CSSProperties, ReactNode } from "react";
import { useMediaQuery } from "../useMediaQuery";
import { EmptyState } from "../States";

/** true quando o sistema pede menos movimento: os gráficos desligam a animação. */
export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

export function ChartEmpty() {
  return <EmptyState title="Sem dados neste período" />;
}

/** Casca comum: figure rotulada + área do gráfico + legenda visual + tabela acessível. */
export function ChartFigure({
  label,
  legend,
  table,
  children,
  className,
}: {
  label: string;
  legend?: ReactNode;
  table: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <figure className={["chart", className].filter(Boolean).join(" ")} aria-label={label}>
      {children}
      {legend}
      {/* Tabela com .visually-hidden ignora a largura de 1px e alarga a página em 360px: ocultar o div. */}
      <div className="visually-hidden">{table}</div>
    </figure>
  );
}

export type LegendItem = { key: string; name: string; color: string; dashed?: boolean };

/** Legenda só visual (aria-hidden): a tabela oculta já diz tudo para leitor de tela. */
export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="chart-legend" aria-hidden="true">
      {items.map((it) => (
        <li key={it.key}>
          <span
            className={`chart-legend__swatch${it.dashed ? " chart-legend__swatch--dashed" : ""}`}
            style={{ "--swatch": it.color } as CSSProperties}
          />
          {it.name}
        </li>
      ))}
    </ul>
  );
}
