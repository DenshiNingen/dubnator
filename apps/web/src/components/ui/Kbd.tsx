import type { ReactNode } from "react";

/* ------------------------------------------------------------------ */
/*  Kbd — a physical-key chip for keyboard shortcuts.                  */
/* ------------------------------------------------------------------ */
export default function Kbd({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <kbd
      className={[
        "inline-flex min-w-[1.6em] items-center justify-center rounded-md border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] font-medium leading-none text-text panel-sheen shadow-[0_1px_0_0_rgba(0,0,0,0.6)]",
        className ?? "",
      ].join(" ")}
    >
      {children}
    </kbd>
  );
}
