import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { formatCents } from "../features/chat/money";

export { formatCents };

const KEY = "finance.hideValues";

type HideValues = { hidden: boolean; toggle(): void };

const HideValuesContext = createContext<HideValues>({ hidden: false, toggle: () => {} });

function readStored(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Olho de ocultar valores: vale no app inteiro e é lembrado no aparelho (localStorage pode falhar). */
export function HideValuesProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(readStored);
  const toggle = useCallback(() => {
    setHidden((h) => {
      const next = !h;
      try {
        localStorage.setItem(KEY, next ? "1" : "0");
      } catch {
        /* sem armazenamento: vale só nesta visita */
      }
      return next;
    });
  }, []);
  const value = useMemo(() => ({ hidden, toggle }), [hidden, toggle]);
  return <HideValuesContext.Provider value={value}>{children}</HideValuesContext.Provider>;
}

export function useHideValues(): HideValues {
  return useContext(HideValuesContext);
}

type MoneyProps = { cents: number; signed?: boolean; tone?: "auto" | "none"; className?: string };

/** Exibe centavos em reais. `signed` mostra +/− e, por padrão, colore receita/despesa. */
export function Money({ cents, signed = false, tone, className }: MoneyProps) {
  const { hidden } = useHideValues();
  const classes = ["money"];
  if (className) classes.push(className);
  if (hidden) {
    classes.push("money--hidden");
    return (
      <span className={classes.join(" ")} aria-label="Valor oculto" role="img">
        R$ •••••
      </span>
    );
  }
  const effectiveTone = tone ?? (signed ? "auto" : "none");
  if (effectiveTone === "auto" && cents !== 0) classes.push(cents > 0 ? "money--income" : "money--expense");
  const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
  const text = signed ? `${sign}${formatCents(Math.abs(cents))}` : formatCents(cents);
  return <span className={classes.join(" ")}>{text}</span>;
}
