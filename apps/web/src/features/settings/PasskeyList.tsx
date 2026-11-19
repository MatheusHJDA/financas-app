import { useState } from "react";
import { deletePasskey, errorText, type PasskeyOut } from "../admin/adminApi";
import { formatDate, formatDateTime } from "../admin/format";
import { ConfirmBar } from "../accounts/ConfirmBar";
import { Button } from "../../ui";
import "../accounts/ui.css";
import "./settings.css";

interface Props {
  keys: PasskeyOut[];
  /** Pergunta da confirmação antes de remover. */
  confirmMessage: string;
  /** Chamado depois de remover (recarregar a lista). */
  onRemoved: () => void | Promise<unknown>;
}

/** Chaves de acesso: "nome · cadastrado em … · último uso …" com Remover e confirmação em linha. */
export function PasskeyList({ keys, confirmMessage, onRemoved }: Props) {
  const [asking, setAsking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: number) {
    setBusy(true);
    setError(null);
    try {
      await deletePasskey(id);
      setAsking(null);
      await onRemoved();
    } catch (e) {
      setError(errorText(e, "Não foi possível remover. Tente de novo."));
    } finally {
      setBusy(false);
    }
  }

  if (keys.length === 0) return <p className="muted">Nenhuma chave cadastrada.</p>;
  return (
    <ul className="pk-list">
      {keys.map((k) => (
        <li key={k.id} className="pk-item">
          <div className="pk-item__text">
            <strong>{k.device_label}</strong>
            <span className="muted">
              cadastrado em {formatDate(k.created_at)} ·{" "}
              {k.last_used_at ? `último uso ${formatDateTime(k.last_used_at)}` : "nunca usado"}
            </span>
          </div>
          {asking === k.id ? (
            <ConfirmBar
              message={confirmMessage}
              confirmLabel="Remover chave"
              danger
              busy={busy}
              error={error}
              onConfirm={() => void remove(k.id)}
              onCancel={() => {
                setAsking(null);
                setError(null);
              }}
            />
          ) : (
            <Button
              aria-label={`Remover ${k.device_label}`}
              onClick={() => {
                setError(null);
                setAsking(k.id);
              }}
            >
              Remover
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
