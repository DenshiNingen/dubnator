/* ------------------------------------------------------------------ */
/*  Led — a tiny lit indicator dot (faceplate detail).                 */
/*  color: accent (orange) | amber | muted. className can override     */
/*  size / color via Tailwind (used with ! in some call-sites).        */
/* ------------------------------------------------------------------ */
type LedColor = "accent" | "amber" | "muted";

const TONE: Record<LedColor, string> = {
  accent: "bg-accent shadow-[0_0_8px_1px_var(--color-accent)]",
  amber: "bg-accent-2 shadow-[0_0_8px_1px_var(--color-accent-2)]",
  muted: "bg-muted/60 shadow-none",
};

export default function Led({
  color = "accent",
  className,
}: {
  color?: LedColor;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={[
        "inline-block size-2 shrink-0 rounded-full",
        TONE[color],
        className ?? "",
      ].join(" ")}
    />
  );
}
