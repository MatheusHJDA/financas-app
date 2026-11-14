import { Skeleton, SkeletonGroup } from "../ui";

/** Esqueleto genérico enquanto o código de uma tela carrega: título + três cartões. */
export function RouteSkeleton() {
  return (
    <SkeletonGroup label="Carregando tela">
      <Skeleton width="45%" height="1.75rem" />
      <Skeleton variant="block" />
      <Skeleton variant="block" />
      <Skeleton variant="block" />
    </SkeletonGroup>
  );
}
