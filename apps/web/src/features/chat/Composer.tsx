import { Camera, FileText, Image, PencilLine, SendHorizontal, X } from "lucide-react";
import { useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Button, IconButton } from "../../ui";
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

  const AttachIcon = file?.type === "application/pdf" ? FileText : Image;

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
          <AttachIcon aria-hidden="true" size={18} strokeWidth={1.75} className="attachment-icon" />
          <span className="attachment-name">
            {file.name} <span className="muted">({sizeLabel(file.size)})</span>
          </span>
          <IconButton
            icon={X}
            label={`Remover anexo ${file.name}`}
            className="attachment-remove"
            disabled={sending}
            onClick={() => setFile(null)}
          />
        </div>
      ) : null}

      {fileError ? (
        <p className="chat-field-error" role="alert">
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
        <label className="file-btn">
          <input type="file" accept="image/*" capture="environment" onChange={pick} disabled={sending} />
          <Camera aria-hidden="true" size={20} strokeWidth={1.75} />
          <span className="sr-only">Câmera</span>
        </label>
        <label className="file-btn">
          <input type="file" accept="image/*" onChange={pick} disabled={sending} />
          <Image aria-hidden="true" size={20} strokeWidth={1.75} />
          <span className="sr-only">Galeria</span>
        </label>
        <label className="file-btn">
          <input type="file" accept="application/pdf" onChange={pick} disabled={sending} />
          <FileText aria-hidden="true" size={20} strokeWidth={1.75} />
          <span className="sr-only">PDF</span>
        </label>
        <Button icon={PencilLine} onClick={onManual}>
          Lançar à mão
        </Button>
        <Button type="submit" variant="primary" icon={SendHorizontal} className="composer-send" disabled={!canSend}>
          Enviar
        </Button>
      </div>
    </form>
  );
}
