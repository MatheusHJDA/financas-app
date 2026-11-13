import { useId } from "react";

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

/** Confirmação em linha: nada é gravado até o toque em "confirmar". */
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
  const showConfirm = !error || retryable;
  return (
    <div className="u8-confirm" role="alertdialog" aria-labelledby={id}>
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
