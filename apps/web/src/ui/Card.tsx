import { useId, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Money } from "./money";

export type Tone = "income" | "expense" | "info" | "warning" | "neutral";

type CardProps = { title?: string; icon?: LucideIcon; action?: ReactNode; children: ReactNode; className?: string };

/** Cartão branco com sombra. Com título vira <section> nomeada (role region). */
export function Card({ title, icon: Icon, action, children, className }: CardProps) {
  const id = useId();
  const cls = className ? `ui-card ${className}` : "ui-card";
  if (!title) return <div className={cls}>{children}</div>;
  return (
    <section className={cls} aria-labelledby={id}>
      <header className="ui-card__head">
        {Icon ? <Icon aria-hidden="true" size={18} strokeWidth={1.75} className="ui-card__icon" /> : null}
        <h2 id={id} className="ui-card__title">
          {title}
        </h2>
        {action ? <div className="ui-card__action">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

type StatCardProps = {
  label: string;
  icon: LucideIcon;
  tone: Tone;
  cents?: number;
  value?: ReactNode;
  hint?: ReactNode;
};

/** Cartão de número: ícone em bolha colorida + rótulo + valor. */
export function StatCard({ label, icon: Icon, tone, cents, value, hint }: StatCardProps) {
  return (
    <div role="group" aria-label={label} className={`ui-stat ui-stat--${tone}`}>
      <span className="ui-stat__bubble" aria-hidden="true">
        <Icon size={20} strokeWidth={1.9} />
      </span>
      <div className="ui-stat__body">
        <span className="ui-stat__label">{label}</span>
        <span className="ui-stat__value">{cents !== undefined ? <Money cents={cents} /> : value}</span>
        {hint ? <span className="ui-stat__hint">{hint}</span> : null}
      </div>
    </div>
  );
}
