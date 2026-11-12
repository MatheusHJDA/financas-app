export type Platform = "iphone" | "android" | "other";

export function detectPlatform(userAgent: string = navigator.userAgent): Platform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iphone";
  if (/Android/i.test(userAgent)) return "android";
  return "other";
}

/** Rótulo do aparelho enviado no login (sem dados pessoais). */
export function deviceLabel(userAgent?: string): string {
  const platform = detectPlatform(userAgent);
  if (platform === "iphone") return "iPhone";
  if (platform === "android") return "Android";
  return "Navegador";
}
