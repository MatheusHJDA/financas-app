import type { ReactNode } from "react";
import { AlertCircle, Inbox } from "lucide-react";

/** Spinner: só para ações curtas ("Salvando…"). Telas e seções usam Skeleton. */
export function LoadingState({ label = "Carregando…" }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state state--error" role="alert">
      <AlertCircle aria-hidden="true" size={28} strokeWidth={1.75} />
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="btn" onClick={onRetry}>
          Tentar de novo
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="state">
      <span className="state-icon" aria-hidden="true">
        <Inbox size={24} strokeWidth={1.75} />
      </span>
      <p className="state-title">{title}</p>
      {hint ? <p className="muted">{hint}</p> : null}
      {action}
    </div>
  );
}
