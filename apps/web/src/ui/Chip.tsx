import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type ChipProps = { selected: boolean; onClick(): void; children: ReactNode; icon?: LucideIcon };

export function Chip({ selected, onClick, children, icon: Icon }: ChipProps) {
  return (
    <button
      type="button"
      className={selected ? "ui-chip ui-chip--on" : "ui-chip"}
      aria-pressed={selected}
      onClick={onClick}
    >
      {Icon ? <Icon aria-hidden="true" size={16} strokeWidth={1.75} /> : null}
      {children}
    </button>
  );
}

export function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="ui-chip-group">
      {children}
    </div>
  );
}
