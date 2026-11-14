import { useId } from "react";

/** Estrela de quatro pontas própria (símbolo de IA do app), com degradê. Não é o logo de nenhuma marca. */
export function SparkleIcon({ size = 24, title }: { size?: number; title?: string }) {
  const id = `sparkle-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className="ui-sparkle"
    >
      <defs>
        <linearGradient id={id} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--sparkle-a)" />
          <stop offset="0.55" stopColor="var(--sparkle-b)" />
          <stop offset="1" stopColor="var(--sparkle-c)" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${id})`}
        d="M12 1.5c.5 5.6 4.9 10 10.5 10.5-5.6.5-10 4.9-10.5 10.5C11.5 16.9 7.1 12.5 1.5 12 7.1 11.5 11.5 7.1 12 1.5Z"
      />
    </svg>
  );
}
