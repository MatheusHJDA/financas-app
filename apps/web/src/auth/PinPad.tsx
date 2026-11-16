import { Delete } from "lucide-react";
import "./login.css";

export const PIN_LENGTH = 6;

interface PinPadProps {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

// Teclado numérico redondo (alvos ≥ 56px) com pontos que preenchem a cada dígito.
export function PinPad({ value, disabled, onChange }: PinPadProps) {
  const add = (d: string) => {
    if (!disabled && value.length < PIN_LENGTH) onChange(value + d);
  };
  return (
    <div className="login-pad">
      <div className="login-dots" role="img" aria-label={`${value.length} de ${PIN_LENGTH} dígitos`}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} className={i < value.length ? "login-dot login-dot--on" : "login-dot"} />
        ))}
      </div>
      {/* Os pontos são imagem; esta região avisa o leitor de tela a cada dígito (sem dizer qual). */}
      <span role="status" className="visually-hidden">
        {value.length === 0 ? "Nenhum dígito digitado" : `${value.length} de ${PIN_LENGTH} dígitos digitados`}
      </span>
      <div className="login-keys">
        {DIGITS.map((d) => (
          <button key={d} type="button" className="login-key" disabled={disabled} onClick={() => add(d)}>
            {d}
          </button>
        ))}
        <span aria-hidden="true" />
        <button type="button" className="login-key" disabled={disabled} onClick={() => add("0")}>
          0
        </button>
        <button
          type="button"
          className="login-key login-key--aux"
          aria-label="Apagar último dígito"
          disabled={disabled || value.length === 0}
          onClick={() => onChange(value.slice(0, -1))}
        >
          <Delete aria-hidden="true" size={24} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
