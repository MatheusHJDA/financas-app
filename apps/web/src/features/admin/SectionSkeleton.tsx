import { Skeleton, SkeletonGroup } from "../../ui";

/** Esqueleto de seção do painel: cartões de números (opcional) + um cartão com linhas. */
export function SectionSkeleton({ label, stats = 0, rows = 3 }: { label: string; stats?: number; rows?: number }) {
  return (
    <SkeletonGroup label={label}>
      {stats > 0 ? (
        <div className="admin-stat-grid">
          {Array.from({ length: stats }, (_, i) => (
            <Skeleton key={i} variant="block" height="4.5rem" />
          ))}
        </div>
      ) : null}
      <div className="ui-card admin-skel-card">
        <Skeleton width="40%" />
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} variant="block" height="3rem" />
        ))}
      </div>
    </SkeletonGroup>
  );
}
