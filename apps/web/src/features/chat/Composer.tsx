import { useState, type ChangeEvent, type KeyboardEvent } from "react";
import { validateAttachment } from "./sendIngest";

interface Props {
  sending: boolean;
  /** 0–100 enquanto o arquivo sobe; null quando não há upload em andamento. */
  progress: number | null;
  /** Devolve true se o envio deu certo (a caixa então é limpa). */
  onSend: (input: { text: string; file: File | null }) => Promise<boolean>;
  onManual: () => void;
}

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

export function Composer({ sending, progress, onSend, onManual }: Props) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const canSend = !sending && (text.trim() !== "" || file !== null);

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    e.target.value = ""; // permite escolher o mesmo arquivo de novo
    if (!picked) return;
    const problem = validateAttachment(picked);
    setFileError(problem);
    // anexo recusado não deixa o anterior para trás (senão "Enviar" mandaria o antigo)
    setFile(problem ? null : picked);
  };

  const send = async () => {
    if (!canSend) return;
    const ok = await onSend({ text, file });
    if (ok) {
      setText("");
      setFile(null);
      setFileError(null);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {file ? (
        <div className="attachment" role="group" aria-label="Anexo">
          <span className="attachment-name">
            {file.type === "application/pdf" ? "📄" : "🖼️"} {file.name} <span className="muted">({sizeLabel(file.size)})</span>
          </span>
          <button
            type="button"
            className="btn btn--icon"
            aria-label={`Remover anexo ${file.name}`}
            disabled={sending}
            onClick={() => setFile(null)}
          >
            ✕
          </button>
        </div>
      ) : null}

      {fileError ? (
        <p className="field-error" role="alert">
          {fileError}
        </p>
      ) : null}

      <div className="composer-status" aria-live="polite">
        {sending ? (
          <>
            {progress !== null && progress < 100 ? (
              <>
                <progress max={100} value={progress} aria-label="Envio do arquivo" />
                <span>Enviando… {progress}%</span>
              </>
            ) : (
              <span>Lendo com a IA… isso pode levar alguns segundos.</span>
            )}
          </>
        ) : null}
      </div>

      <label className="sr-only" htmlFor="chat-message">
        Mensagem
      </label>
      <textarea
        id="chat-message"
        className="composer-text"
        rows={2}
        placeholder="Ex.: mercado 45,90 no Nubank"
        value={text}
        disabled={sending}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
      />

      <div className="composer-bar">
        <label className="btn file-btn">
          <input type="file" accept="image/*" capture="environment" onChange={pick} disabled={sending} />
          <span aria-hidden="true">📷</span> Câmera
        </label>
        <label className="btn file-btn">
          <input type="file" accept="image/*" onChange={pick} disabled={sending} />
          <span aria-hidden="true">🖼️</span> Galeria
        </label>
        <label className="btn file-btn">
          <input type="file" accept="application/pdf" onChange={pick} disabled={sending} />
          <span aria-hidden="true">📄</span> PDF
        </label>
        <button type="button" className="btn" onClick={onManual}>
          Lançar à mão
        </button>
        <button type="submit" className="btn btn--primary composer-send" disabled={!canSend}>
          Enviar
        </button>
      </div>
    </form>
  );
}
