import type { ReactNode } from "react";

/* ------------------------------------------------------------------ */
/*  Section — vertical rhythm wrapper for a page band.                 */
/*  Forwards arbitrary props (id, aria-*) onto the <section>.          */
/* ------------------------------------------------------------------ */
type SectionProps = {
  className?: string;
  children: ReactNode;
} & React.HTMLAttributes<HTMLElement>;

export default function Section({
  className,
  children,
  ...rest
}: SectionProps) {
  return (
    <section
      className={["py-20 sm:py-24 lg:py-28", className ?? ""].join(" ")}
      {...rest}
    >
      {children}
    </section>
  );
}
