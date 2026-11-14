import type { ReactNode } from "react";
import type { Tone } from "./Card";

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  onClick?(): void;
};

export function ListItem({ title, subtitle, leading, trailing, onClick }: Props) {
  const inner = (
    <>
      {leading ? <span className="ui-li__lead">{leading}</span> : null}
      <span className="ui-li__text">
        <span className="ui-li__title">{title}</span>
        {subtitle ? <span className="ui-li__sub">{subtitle}</span> : null}
      </span>
      {trailing ? <span className="ui-li__trail">{trailing}</span> : null}
    </>
  );
  return onClick ? (
    <button type="button" className="ui-li ui-li--btn" onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className="ui-li">{inner}</div>
  );
}

/** Círculo com a inicial (no lugar de logos de banco). */
export function Avatar({ name, tone = "neutral" }: { name: string; tone?: Tone }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span aria-hidden="true" className={`ui-avatar ui-avatar--${tone}`}>
      {initial}
    </span>
  );
}
