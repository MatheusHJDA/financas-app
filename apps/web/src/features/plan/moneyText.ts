import { formatCents, useHideValues } from "../../ui";

/** Dinheiro em frases (texto corrido): respeita o olho de ocultar, como o componente `Money`. */
export function useMoneyText(): (cents: number) => string {
  const { hidden } = useHideValues();
  return (cents) => (hidden ? "R$ •••••" : formatCents(cents));
}
