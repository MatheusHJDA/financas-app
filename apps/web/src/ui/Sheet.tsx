import { X } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { IconButton } from "./Button";

type Props = { open: boolean; title: string; onClose(): void; children: ReactNode };

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** Torna inerte tudo que não é ancestral do painel; devolve a função que desfaz só o que ela mesma marcou. */
function inertBehind(node: HTMLElement): () => void {
  const marked: HTMLElement[] = [];
  let current: HTMLElement | null = node;
  while (current && current !== document.body) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) break;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === current || !(sibling instanceof HTMLElement)) continue;
      if (sibling.hasAttribute("inert")) continue;
      sibling.setAttribute("inert", "");
      marked.push(sibling);
    }
    current = parent;
  }
  return () => {
    for (const el of marked) el.removeAttribute("inert");
  };
}

/**
 * Painel que sobe de baixo no celular e vira janela central no computador.
 * Modal de verdade: o foco entra no diálogo, Tab não sai dele, o fundo fica inerte,
 * Esc e "Fechar" fecham e o foco volta a quem abriu.
 */
export function Sheet({ open, title, onClose, children }: Props) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const restoreBackground = backdrop.current ? inertBehind(backdrop.current) : () => {};
    return () => {
      restoreBackground();
      returnTo?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      e.preventDefault();
      panel.current.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div ref={backdrop} className="ui-sheet-backdrop" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className="ui-sheet"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <header className="ui-sheet__head">
          <h2 id={id} className="ui-sheet__title">
            {title}
          </h2>
          <IconButton icon={X} label="Fechar" onClick={onClose} />
        </header>
        <div className="ui-sheet__body">{children}</div>
      </div>
    </div>
  );
}
