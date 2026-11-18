import { useState } from "react";
import { Button } from "../ui/Button";

interface RecoveryCodesProps {
  codes: string[];
  onDone: () => void;
}

/** Códigos de emergência: aparecem uma vez, só seguem depois de "Já guardei". */
export function RecoveryCodes({ codes, onDone }: RecoveryCodesProps) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section className="login-codes" aria-labelledby="codes-title">
      <h2 id="codes-title">Guarde seus códigos de emergência</h2>
      <p>
        Cada código vale uma vez e serve para liberar um aparelho novo se você perder todos. Eles não aparecem de
        novo.
      </p>
      <ul className="login-codes__list">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="login-actions">
        <Button block onClick={() => void copy()}>
          {copied ? "Copiado" : "Copiar"}
        </Button>
        <Button block variant="primary" onClick={onDone}>
          Já guardei
        </Button>
      </div>
    </section>
  );
}
