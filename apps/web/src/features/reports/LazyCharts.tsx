import { lazy, Suspense, type ComponentProps } from "react";
import { Skeleton, SkeletonGroup } from "../../ui";

// Recharts é pesado: carrega só quando há gráfico para mostrar. O título, os filtros e os totais
// aparecem antes, e a tela não espera a biblioteca para responder.
const Donut = lazy(() => import("../../ui/charts/DonutChart").then((m) => ({ default: m.DonutChart })));
const Line = lazy(() => import("../../ui/charts/LineChart").then((m) => ({ default: m.LineChart })));

function fallback() {
  return (
    <SkeletonGroup label="Carregando gráfico">
      <Skeleton variant="block" height="220px" />
    </SkeletonGroup>
  );
}

export function LazyDonutChart(props: ComponentProps<typeof Donut>) {
  return (
    <Suspense fallback={fallback()}>
      <Donut {...props} />
    </Suspense>
  );
}

export function LazyLineChart(props: ComponentProps<typeof Line>) {
  return (
    <Suspense fallback={fallback()}>
      <Line {...props} />
    </Suspense>
  );
}
