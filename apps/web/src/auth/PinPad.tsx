export const PIN_LENGTH = 6;

interface PinPadProps {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function PinPad({ value, disabled, onChange }: PinPadProps) {
  const add = (d: string) => {
    if (!disabled && value.length < PIN_LENGTH) onChange(value + d);
  };
  return (
    <div className="pinpad">
      <div className="pin-dots" role="img" aria-label={`${value.length} de ${PIN_LENGTH} dígitos`}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} className={i < value.length ? "pin-dot pin-dot--on" : "pin-dot"} />
        ))}
      </div>
      <div className="pin-keys">
        {DIGITS.map((d) => (
          <button key={d} type="button" className="pin-key" disabled={disabled} onClick={() => add(d)}>
            {d}
          </button>
        ))}
        <span aria-hidden="true" />
        <button type="button" className="pin-key" disabled={disabled} onClick={() => add("0")}>
          0
        </button>
        <button
          type="button"
          className="pin-key pin-key--aux"
          aria-label="Apagar último dígito"
          disabled={disabled || value.length === 0}
          onClick={() => onChange(value.slice(0, -1))}
        >
          ⌫
        </button>
      </div>
    </div>
  );
}
