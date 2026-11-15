// Tema do app: claro, escuro ou automático (segue o sistema). tokens.css já trata [data-theme].
export type ThemeChoice = "light" | "dark" | "auto";

export const THEME_KEY = "finance.theme";

const CHOICES: readonly ThemeChoice[] = ["light", "dark", "auto"];
const META_LIGHT = "#15803d";
const META_DARK = "#0d1110";

/** Lê a escolha lembrada neste aparelho; qualquer falha ou valor estranho vira "auto". */
export function readTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return CHOICES.find((c) => c === stored) ?? "auto";
  } catch {
    return "auto";
  }
}

/** Lembra a escolha; sem localStorage o tema vale só até recarregar. */
export function saveTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* sem armazenamento: segue sem lembrar */
  }
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Marca `data-theme` em <html> ("auto" remove) e ajusta a cor da barra do navegador. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  const dark = choice === "dark" || (choice === "auto" && systemPrefersDark());
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? META_DARK : META_LIGHT);
}

/** Chamada uma vez antes do primeiro render (main.tsx). */
export function initTheme(): void {
  applyTheme(readTheme());
}
