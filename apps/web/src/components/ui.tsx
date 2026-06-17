import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from "react";

/* ------------------------------------------------------------------ */
/*  Tiny class joiner — no deps                                       */
/* ------------------------------------------------------------------ */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ */
/*  Container — centered max-width with horizontal gutter             */
/* ------------------------------------------------------------------ */
export function Container({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("mx-auto w-full max-w-6xl px-5", className)} {...props}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section — semantic <section> with vertical rhythm + optional id   */
/* ------------------------------------------------------------------ */
export function Section({
  id,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <section
      id={id}
      className={cx("py-20 sm:py-28", className)}
      {...props}
    >
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Eyebrow — mono uppercase accent label (with optional leading LED) */
/* ------------------------------------------------------------------ */
export function Eyebrow({
  className,
  children,
  led = false,
}: {
  className?: string;
  children: ReactNode;
  led?: boolean;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-[0.2em] text-accent",
        className,
      )}
    >
      {led ? <Led /> : null}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Button — primary (filled accent) / ghost (bordered)               */
/*  Renders <a> when href is set, otherwise <button>.                 */
/* ------------------------------------------------------------------ */
type ButtonVariant = "primary" | "ghost";
type ButtonSize = "sm" | "md";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-md font-mono text-sm font-medium uppercase tracking-wide transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5",
  md: "h-11 px-5",
};

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-bg hover:bg-accent/90 panel-sheen shadow-[0_0_24px_-6px_var(--color-accent)]",
  ghost:
    "border border-line bg-panel text-text hover:border-accent hover:text-accent",
};

type CommonButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
};

type ButtonAsLink = CommonButtonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children"> & {
    href: string;
  };

type ButtonAsButton = CommonButtonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & {
    href?: undefined;
  };

export function Button(props: ButtonAsLink | ButtonAsButton) {
  const {
    variant = "primary",
    size = "md",
    className,
    children,
    ...rest
  } = props;

  const classes = cx(
    buttonBase,
    buttonSizes[size],
    buttonVariants[variant],
    className,
  );

  if ("href" in rest && rest.href) {
    const { href, ...anchorRest } =
      rest as AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };
    const isExternal = /^https?:\/\//.test(href);
    const externalProps = isExternal
      ? { target: "_blank", rel: "noopener noreferrer" }
      : {};
    return (
      <a href={href} className={classes} {...externalProps} {...anchorRest}>
        {children}
      </a>
    );
  }

  const buttonRest = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button className={classes} {...buttonRest}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Pill / Badge — small mono chip on a panel surface                 */
/* ------------------------------------------------------------------ */
export function Pill({
  className,
  children,
  accent = false,
}: {
  className?: string;
  children: ReactNode;
  accent?: boolean;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.15em]",
        accent
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-line bg-panel-2 text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}

// Badge — alias of Pill for semantic clarity at call sites.
export const Badge = Pill;

/* ------------------------------------------------------------------ */
/*  Kbd — keyboard chip                                               */
/* ------------------------------------------------------------------ */
export function Kbd({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <kbd
      className={cx(
        "inline-flex min-w-6 items-center justify-center rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] leading-none text-text panel-sheen",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/* ------------------------------------------------------------------ */
/*  Led — small glowing status dot                                    */
/* ------------------------------------------------------------------ */
export function Led({
  className,
  color = "accent",
}: {
  className?: string;
  color?: "accent" | "amber" | "muted";
}) {
  const tones: Record<string, string> = {
    accent: "bg-accent shadow-[0_0_8px_1px_var(--color-accent)]",
    amber: "bg-accent-2 shadow-[0_0_8px_1px_var(--color-accent-2)]",
    muted: "bg-muted",
  };
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-block size-2 shrink-0 rounded-full",
        tones[color],
        className,
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Panel — reusable rack-unit surface                                */
/* ------------------------------------------------------------------ */
export function Panel({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "rounded-xl border border-line bg-panel panel-sheen",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
