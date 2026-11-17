/** Indicador do puxar para atualizar: fixo no topo, abaixo da área segura. */
export function PullIndicator({ distance, refreshing }: { distance: number; refreshing: boolean }) {
  if (!refreshing && distance <= 0) return null;
  const offset = refreshing ? 16 : Math.min(distance, 64) - 40;
  return (
    <div
      className="pull-indicator"
      role="status"
      style={{ transform: `translate(-50%, ${offset}px)` }}
    >
      {refreshing ? "Atualizando…" : "Solte para atualizar"}
    </div>
  );
}
