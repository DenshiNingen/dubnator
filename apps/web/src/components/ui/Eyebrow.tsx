import type { ReactNode } from "react";
import Led from "./Led";

/* ------------------------------------------------------------------ */
/*  Eyebrow — mono uppercase kicker, optionally led-prefixed.          */
/* ------------------------------------------------------------------ */
export default function Eyebrow({
  led = false,
  className,
  children,
}: {
  led?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={[
        "inline-flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.25em] text-muted",
        className ?? "",
      ].join(" ")}
    >
      {led ? <Led color="accent" /> : null}
      {children}
    </span>
  );
}
