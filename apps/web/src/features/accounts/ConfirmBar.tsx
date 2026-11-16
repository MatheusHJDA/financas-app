import { useEffect, useId, useRef } from "react";

interface Props {
  /** Pergunta, ex.: "Marcar Luz como paga?". */
  message: string;
  confirmLabel: string;
  busy?: boolean;
  /** Erro do servidor; some o botão de confirmar quando não adianta tentar de novo. */
  error?: string | null;
  retryable?: boolean;
  /** Orientação extra depois do erro (ex.: "Lance o pagamento pelo chat."). */
  hint?: string | null;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmação em linha: nada é gravado até o toque em "confirmar".
 * Vive dentro de um `Sheet` (que já é o diálogo modal), então é um grupo nomeado, não um
 * segundo `alertdialog`. Ao aparecer recebe o foco (o botão que a abriu sumiu) e, ao sair,
 * devolve o foco a quem estava com ele, se ainda existir.
 */
export function ConfirmBar({
  message,
  confirmLabel,
  busy = false,
  error = null,
  retryable = true,
  hint = null,
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const showConfirm = !error || retryable;

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => {
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, []);

  return (
    <div ref={root} className="u8-confirm" role="group" aria-labelledby={id} tabIndex={-1}>
      <p id={id}>
        <strong>{message}</strong>
      </p>
      {error ? (
        <p className="u8-err" role="alert">
          {error}
          {hint ? ` ${hint}` : ""}
        </p>
      ) : null}
      <div className="u8-actions">
        {showConfirm ? (
          <button
            type="button"
            className={`u8-btn ${danger ? "u8-btn--danger" : "u8-btn--primary"}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        ) : null}
        <button type="button" className="u8-btn" disabled={busy} onClick={onCancel}>
          {showConfirm ? "Cancelar" : "Fechar"}
        </button>
      </div>
    </div>
  );
}
