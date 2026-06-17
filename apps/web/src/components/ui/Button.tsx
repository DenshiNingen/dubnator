import type { MouseEventHandler, ReactNode } from "react";
import Link from "next/link";

/* ------------------------------------------------------------------ */
/*  Button — link-styled CTA. Always renders an anchor.                */
/*  Internal targets (#hash, /path) go through next/link; external     */
/*  URLs use a plain <a> with target=_blank + safe rel.                */
/* ------------------------------------------------------------------ */
type Variant = "primary" | "ghost";
type Size = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-mono font-semibold uppercase tracking-[0.15em] transition-all duration-150 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "border border-accent bg-accent text-bg shadow-[0_0_24px_-6px_var(--color-accent)] hover:bg-accent/90 hover:shadow-[0_0_28px_-4px_var(--color-accent)]",
  ghost:
    "border border-line bg-panel text-text panel-sheen hover:border-accent/60 hover:text-accent",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-3.5 text-[11px]",
  md: "h-11 px-5 text-xs",
};

export default function Button({
  href,
  variant = "primary",
  size = "md",
  className,
  onClick,
  children,
  "aria-label": ariaLabel,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  children: ReactNode;
  "aria-label"?: string;
}) {
  const classes = [BASE, VARIANTS[variant], SIZES[size], className ?? ""].join(
    " ",
  );

  const isExternal = /^https?:\/\//.test(href);

  if (isExternal) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={classes}
        onClick={onClick}
        aria-label={ariaLabel}
      >
        {children}
      </a>
    );
  }

  return (
    <Link
      href={href}
      className={classes}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      {children}
    </Link>
  );
}
