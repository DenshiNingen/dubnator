import type { ReactNode } from "react";

/* ------------------------------------------------------------------ */
/*  Pill — small bordered tag/chip. accent variant tints the edge.     */
/* ------------------------------------------------------------------ */
export default function Pill({
  accent = false,
  className,
  children,
}: {
  accent?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.15em] panel-sheen",
        accent
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-line bg-panel-2 text-muted",
        className ?? "",
      ].join(" ")}
    >
      {children}
    </span>
  );
}
