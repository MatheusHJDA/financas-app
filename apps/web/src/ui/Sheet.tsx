import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconButton } from "./Button";

type Props = { open: boolean; title: string; onClose(): void; children: ReactNode };

/** Painel que sobe de baixo no celular e vira janela central no computador. Esc e "Fechar" fecham. */
export function Sheet({ open, title, onClose, children }: Props) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => {
      returnTo?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="ui-sheet-backdrop" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className="ui-sheet"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
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
