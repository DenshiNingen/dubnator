import { Button, Container, Eyebrow, Led, Pill, Section } from "@/components/ui";

const RELEASES_LATEST =
  "https://github.com/DenshiNingen/dubnator/releases/latest";
const RELEASES_ALL = "https://github.com/DenshiNingen/dubnator/releases";
const REPO = "https://github.com/DenshiNingen/dubnator";

type Platform = {
  os: string;
  tag: string;
  blurb: string;
  /** Tiny CSS glyph drawn from divs — no image assets. */
  glyph: "apple" | "windows" | "linux";
};

const PLATFORMS: Platform[] = [
  {
    os: "macOS",
    tag: ".dmg",
    blurb: "Universal build. Apple Silicon & Intel, native window.",
    glyph: "apple",
  },
  {
    os: "Windows",
    tag: ".exe",
    blurb: "x64 installer. Low-latency WASAPI output, no browser tab.",
    glyph: "windows",
  },
  {
    os: "Linux",
    tag: ".AppImage",
    blurb: "Portable AppImage. Runs offline, same rack, same routing.",
    glyph: "linux",
  },
];

function PlatformGlyph({ glyph }: { glyph: Platform["glyph"] }) {
  if (glyph === "windows") {
    return (
      <span aria-hidden="true" className="grid size-5 grid-cols-2 gap-0.5">
        <span className="rounded-[1px] bg-current" />
        <span className="rounded-[1px] bg-current" />
        <span className="rounded-[1px] bg-current" />
        <span className="rounded-[1px] bg-current" />
      </span>
    );
  }
  if (glyph === "linux") {
    return (
      <span
        aria-hidden="true"
        className="relative block size-5 rounded-full border-2 border-current"
      >
        <span className="absolute left-1/2 top-1 size-1 -translate-x-1/2 rounded-full bg-current" />
        <span className="absolute bottom-1 left-1/2 h-1.5 w-2.5 -translate-x-1/2 rounded-t-full bg-current" />
      </span>
    );
  }
  // apple — abstract mark, not a logo
  return (
    <span aria-hidden="true" className="relative block size-5">
      <span className="absolute left-1/2 top-0 h-5 w-3.5 -translate-x-1/2 rounded-[60%_60%_55%_55%/55%_55%_65%_65%] bg-current" />
      <span className="absolute -top-0.5 left-[58%] h-2 w-2 rotate-45 rounded-[60%_0_60%_0] bg-current" />
    </span>
  );
}

export default function Download() {
  return (
    <Section id="download" className="relative overflow-hidden">
      {/* faint rack texture */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-grid-fade opacity-[0.35]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-line"
      />

      <Container className="relative">
        <div className="max-w-2xl">
          <Eyebrow led>Desktop / Offline</Eyebrow>
          <h2 className="mt-4 font-sans text-4xl font-semibold tracking-tight text-text sm:text-5xl">
            Take it offline.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">
            The same rack in a native window. No tab, no upload, no account —
            your decks, FX chain and MIDI maps run fully on-device.
          </p>
        </div>

        {/* OS cards */}
        <ul className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PLATFORMS.map((p) => (
            <li key={p.os}>
              <article className="group relative flex h-full flex-col rounded-xl border border-line bg-panel p-6 panel-sheen transition-colors hover:border-accent/50">
                {/* faceplate header row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-lg border border-line bg-panel-2 text-muted transition-colors group-hover:text-accent">
                      <PlatformGlyph glyph={p.glyph} />
                    </span>
                    <h3 className="font-sans text-xl font-semibold text-text">
                      {p.os}
                    </h3>
                  </div>
                  <Pill>{p.tag}</Pill>
                </div>

                <p className="mt-5 text-sm leading-relaxed text-muted">
                  {p.blurb}
                </p>

                <div className="mt-7 flex items-center gap-2">
                  <Led color="muted" className="group-hover:bg-accent group-hover:shadow-[0_0_8px_1px_var(--color-accent)]" />
                  <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
                    Native window · offline
                  </span>
                </div>

                <Button
                  href={RELEASES_LATEST}
                  className="mt-5 w-full"
                  aria-label={`Download Dubnator for ${p.os}`}
                >
                  Download for {p.os}
                </Button>
              </article>
            </li>
          ))}
        </ul>

        {/* honest note + ghost links */}
        <div className="mt-10 flex flex-col gap-6 border-t border-line pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-md text-sm leading-relaxed text-muted">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent-2">
              Note
            </span>{" "}
            Builds are produced by GitHub Actions for each release — open,
            reproducible, signed where the platform allows.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Button href={RELEASES_ALL} variant="ghost" size="sm">
              All releases
            </Button>
            <Button href={REPO} variant="ghost" size="sm">
              <span aria-hidden="true" className="text-accent-2">
                ★
              </span>
              View source / star on GitHub
            </Button>
          </div>
        </div>
      </Container>
    </Section>
  );
}
