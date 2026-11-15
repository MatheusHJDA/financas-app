/**
 * Pontos-base (1% = 100) -> "85,5%". Só inteiros: divisão inteira e resto, sem float.
 * Mostra até duas casas e tira o zero final (8550 -> "85,5%", 8505 -> "85,05%", 2500 -> "25%").
 */
export function formatShare(bp: number): string {
  const total = Math.max(0, Math.trunc(bp));
  const whole = Math.trunc(total / 100);
  const rest = total % 100;
  if (rest === 0) return `${whole}%`;
  const decimals = String(rest).padStart(2, "0").replace(/0$/, "");
  return `${whole},${decimals}%`;
}
