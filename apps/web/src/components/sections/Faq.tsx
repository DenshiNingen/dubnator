import type { ReactNode } from "react";
import { Container, Section, Eyebrow, Button, Pill, Led } from "@/components/ui";

/* ------------------------------------------------------------------ */
/*  FAQ data — short, accurate answers. No JS required (details/summary)*/
/* ------------------------------------------------------------------ */
type Item = {
  q: string;
  a: ReactNode;
};

const items: Item[] = [
  {
    q: "Is it free?",
    a: (
      <>
        Yes. Dubnator is free and fully open-source — no account, no paywall,
        no upsell. Run it, fork it, ship a build. Source and releases live on{" "}
        <a
          href="https://github.com/DenshiNingen/dubnator"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline-offset-4 hover:underline"
        >
          GitHub
        </a>
        .
      </>
    ),
  },
  {
    q: "Does my audio leave my machine?",
    a: (
      <>
        No. Every band, every effect, every meter runs locally through Web
        Audio in your browser. Nothing is uploaded, streamed, or phoned home —
        your mix never leaves the dance.
      </>
    ),
  },
  {
    q: "Do I need a MIDI controller?",
    a: (
      <>
        No — the whole rack is playable with mouse and keyboard. But every knob
        and fader is mappable: Cmd+Shift+click any control to MIDI-learn it,
        with pickup mode and save/load mappings when a controller wants
        hardware under its hands.
      </>
    ),
  },
  {
    q: "Which browsers are supported?",
    a: (
      <>
        Any modern browser with Web Audio — Chromium, Firefox, and Safari are
        all good. For multichannel and live input, desktop Chrome gives the
        most reliable routing and lowest overhead.
      </>
    ),
  },
  {
    q: "What audio formats can I load?",
    a: (
      <>
        Drop in MP3, M4A, WAV, AIFF, or FLAC. Load both decks, build per-deck
        playlists, and queue tracks straight from your library.
      </>
    ),
  },
  {
    q: "Browser or desktop app — what's the difference?",
    a: (
      <>
        Same rack, same controls. The browser version is instant and
        installable as a PWA. The desktop build (Tauri, for Windows / macOS /
        Linux) adds a native window, full offline use, and lower latency.
      </>
    ),
  },
];

/* ------------------------------------------------------------------ */
/*  Single Q/A row — styled native <details> accordion               */
/* ------------------------------------------------------------------ */
function FaqRow({ item, index }: { item: Item; index: number }) {
  const num = String(index + 1).padStart(2, "0");
  return (
    <details
      name="dubnator-faq"
      className="group border-b border-line last:border-b-0 open:bg-panel-2/40"
    >
      <summary className="flex cursor-pointer list-none items-start gap-4 px-5 py-5 transition-colors marker:hidden hover:bg-panel-2/40 sm:px-7 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="mt-0.5 select-none font-mono text-xs tracking-[0.2em] text-muted transition-colors group-open:text-accent"
        >
          {num}
        </span>

        <h3 className="flex-1 text-base font-semibold leading-snug text-text sm:text-lg">
          {item.q}
        </h3>

        {/* +/- toggle glyph, swaps on open via group state */}
        <span
          aria-hidden="true"
          className="relative mt-1 grid size-5 shrink-0 place-items-center rounded border border-line text-muted transition-colors group-open:border-accent group-open:text-accent"
        >
          <span className="absolute h-[1.5px] w-2.5 rounded bg-current" />
          <span className="absolute h-2.5 w-[1.5px] rounded bg-current transition-transform duration-200 group-open:rotate-90 group-open:opacity-0" />
        </span>
      </summary>

      <div className="px-5 pb-6 pl-[3.25rem] pr-12 sm:px-7 sm:pl-[3.75rem]">
        <p className="max-w-2xl text-sm leading-relaxed text-muted sm:text-[15px]">
          {item.a}
        </p>
      </div>
    </details>
  );
}

/* ------------------------------------------------------------------ */
/*  FAQ section                                                       */
/* ------------------------------------------------------------------ */
export default function Faq() {
  return (
    <Section id="faq" className="relative overflow-hidden">
      {/* faint rack grid behind the panel */}
      <div
        aria-hidden="true"
        className="bg-grid-fade pointer-events-none absolute inset-0 opacity-[0.4]"
      />

      <Container className="relative">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:gap-16">
          {/* Left rail — eyebrow + heading */}
          <header className="lg:sticky lg:top-24 lg:self-start">
            <Eyebrow led>FAQ · Manual</Eyebrow>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-text sm:text-4xl">
              Read the
              <br className="hidden sm:block" /> faceplate.
            </h2>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
              Straight answers — no fine print. Everything a selecta needs
              before you patch in and run the riddim.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Pill accent>
                <Led className="size-1.5" /> Open-source
              </Pill>
              <Pill>100% local</Pill>
            </div>

            <div className="mt-8 hidden lg:block">
              <Button href="https://play.dubnator.denshi.io" size="sm">
Pull up the rack
              </Button>
            </div>
          </header>

          {/* Right — accordion panel styled as a rack unit */}
          <div className="rounded-xl border border-line bg-panel panel-sheen">
            {items.map((item, i) => (
              <FaqRow key={item.q} item={item} index={i} />
            ))}
          </div>
        </div>

        {/* Mobile CTA — mirrors the sticky desktop button */}
        <div className="mt-10 lg:hidden">
          <Button
            href="https://play.dubnator.denshi.io"
            size="sm"
            className="w-full sm:w-auto"
          >
            Launch the rack
          </Button>
        </div>
      </Container>
    </Section>
  );
}
