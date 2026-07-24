import Link from "next/link";
import { Container, Eyebrow, Led, Pill } from "@/components/ui";

/* ------------------------------------------------------------------ */
/*  Link groups — internal anchors via next/link, externals via <a>   */
/* ------------------------------------------------------------------ */
const DEMO_URL = "https://play.dubnator.denshi.io";
const REPO_URL = "https://github.com/DenshiNingen/dubnator";
const RELEASES_URL = "https://github.com/DenshiNingen/dubnator/releases/latest";

type FooterLink = {
  label: string;
  href: string;
  external?: boolean;
};

const columns: { heading: string; links: FooterLink[] }[] = [
  {
    heading: "Rack",
    links: [
      { label: "Features", href: "#features" },
      { label: "For the dance", href: "#for-the-dance" },
      { label: "Live demo", href: "#live-demo" },
    ],
  },
  {
    heading: "Run It",
    links: [
      { label: "Demo", href: DEMO_URL, external: true },
      { label: "Download", href: RELEASES_URL, external: true },
      { label: "Releases", href: RELEASES_URL, external: true },
    ],
  },
  {
    heading: "Source",
    links: [
      { label: "GitHub", href: REPO_URL, external: true },
      { label: "Star", href: REPO_URL, external: true },
      { label: "License", href: `${REPO_URL}#license`, external: true },
    ],
  },
];

function FooterLinkItem({ label, href, external }: FooterLink) {
  const className =
    "group inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-text focus-visible:text-text";
  const dot = (
    <span
      aria-hidden="true"
      className="size-1 rounded-full bg-line transition-colors group-hover:bg-accent"
    />
  );

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {dot}
        {label}
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      {dot}
      {label}
    </Link>
  );
}

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-line bg-panel">
      <Container className="py-14 sm:py-16">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          {/* Brand block ------------------------------------------------ */}
          <div className="max-w-sm">
            <Link
              href="/"
              className="inline-flex items-center gap-2.5 font-mono text-lg font-semibold uppercase tracking-[0.22em] text-text transition-colors hover:text-accent"
            >
              <Led />
              Dubnator
            </Link>

            <p className="mt-4 text-sm leading-relaxed text-muted">
              A browser-native dub / reggae sound-system FX rack and channel
              strip for selectas and dub controllers. Isolator kills, tape echo,
              dub siren, sampler — the whole control tower in your hands. Free
              and open-source.
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <Pill accent>Web Audio</Pill>
              <Pill>PWA</Pill>
              <Pill>Tauri Desktop</Pill>
            </div>
          </div>

          {/* Link columns ---------------------------------------------- */}
          {columns.map((col) => (
            <nav
              key={col.heading}
              aria-label={col.heading}
              className="flex flex-col"
            >
              <Eyebrow className="mb-4 text-muted">{col.heading}</Eyebrow>
              <ul className="flex flex-col gap-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <FooterLinkItem {...link} />
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* Baseline ---------------------------------------------------- */}
        <div className="mt-14 flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-muted">
            <Led color="amber" />
            Built for the dance — drop the weight
          </p>

          <p className="font-mono text-xs tracking-wide text-muted">
            <span aria-hidden="true" className="text-line">
              {"// "}
            </span>
            &copy; {year}
            <span aria-hidden="true" className="px-2 text-line">
              ·
            </span>
            <span className="text-text">Denshi</span>
          </p>
        </div>
      </Container>
    </footer>
  );
}
