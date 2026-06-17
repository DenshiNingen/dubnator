import type { ReactNode } from "react";

/* ------------------------------------------------------------------ */
/*  Container — centered max-width wrapper with consistent gutters     */
/* ------------------------------------------------------------------ */
export default function Container({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={[
        "mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8",
        className ?? "",
      ].join(" ")}
    >
      {children}
    </div>
  );
}
