/** Indicador do puxar para atualizar: fixo no topo, abaixo da área segura. A região de status fica sempre montada (leitores de tela). */
export function PullIndicator({
  distance,
  refreshing,
  armed = false,
}: {
  distance: number;
  refreshing: boolean;
  armed?: boolean;
}) {
  const visible = refreshing || distance > 0;
  const offset = refreshing ? 16 : Math.min(distance, 64) * 0.375; // 0 a 24px, sempre abaixo da área segura
  const text = refreshing ? "Atualizando…" : armed ? "Solte para atualizar" : "Puxe para atualizar";
  return (
    <div
      className={visible ? "pull-indicator" : "visually-hidden"}
      role="status"
      style={visible ? { transform: `translate(-50%, ${offset}px)` } : undefined}
    >
      {visible ? text : ""}
    </div>
  );
}
