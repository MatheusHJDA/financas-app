import type { ReactNode } from "react";

type Props = { variant?: "line" | "block" | "circle"; width?: string; height?: string };

export function Skeleton({ variant = "line", width, height }: Props) {
  return <span aria-hidden="true" className={`ui-skel ui-skel--${variant}`} style={{ width, height }} />;
}

/** Envolve skeletons e anuncia "carregando" para leitores de tela. */
export function SkeletonGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="ui-skel-group">
      {children}
    </div>
  );
}
