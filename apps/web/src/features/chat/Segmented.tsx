import type { LucideIcon } from "lucide-react";

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
  icon?: LucideIcon;
}

interface Props<V extends string> {
  label: string;
  options: SegmentedOption<V>[];
  value: V;
  onChange(value: V): void;
}

/** Seletor segmentado (pílula com 2–3 opções). Local da feature; o kit pode promovê-lo. */
export function Segmented<V extends string>({ label, options, value, onChange }: Props<V>) {
  return (
    <div role="group" aria-label={label} className="chat-seg">
      {options.map(({ value: v, label: text, icon: Icon }) => (
        <button
          key={v}
          type="button"
          className={v === value ? "chat-seg__opt chat-seg__opt--on" : "chat-seg__opt"}
          aria-pressed={v === value}
          onClick={() => onChange(v)}
        >
          {Icon ? <Icon aria-hidden="true" size={16} strokeWidth={1.9} /> : null}
          {text}
        </button>
      ))}
    </div>
  );
}
