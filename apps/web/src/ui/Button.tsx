import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  icon?: LucideIcon;
  block?: boolean;
};

export function Button({ variant = "secondary", icon: Icon, block, className, children, type, ...rest }: ButtonProps) {
  const cls = ["ui-btn", `ui-btn--${variant}`];
  if (block) cls.push("ui-btn--block");
  if (className) cls.push(className);
  return (
    <button type={type ?? "button"} className={cls.join(" ")} {...rest}>
      {Icon ? <Icon aria-hidden="true" size={18} strokeWidth={1.75} /> : null}
      {children}
    </button>
  );
}

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string };

export function IconButton({ icon: Icon, label, className, type, ...rest }: IconButtonProps) {
  return (
    <button
      type={type ?? "button"}
      aria-label={label}
      title={label}
      className={className ? `ui-icon-btn ${className}` : "ui-icon-btn"}
      {...rest}
    >
      <Icon aria-hidden="true" size={20} strokeWidth={1.75} />
    </button>
  );
}
