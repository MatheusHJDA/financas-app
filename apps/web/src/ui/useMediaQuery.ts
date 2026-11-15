import { useSyncExternalStore } from "react";

/** true quando a media query casa. Sem matchMedia (testes antigos, SSR), devolve false = celular. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener?.("change", onChange);
      return () => mql.removeEventListener?.("change", onChange);
    },
    () => (typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false),
    () => false,
  );
}

export const DESKTOP_QUERY = "(min-width: 1024px)";
