import type { ReactNode } from "react";
import {
  Container,
  Section,
  Eyebrow,
  Pill,
  Kbd,
  Led,
} from "@/components/ui";

/* ------------------------------------------------------------------ */
/*  Feature data — every spec pulled straight from the rack.          */
/* ------------------------------------------------------------------ */
type Feature = {
  label: string;
  title: string;
  body: string;
  bands?: string[];
};

const features: Feature[] = [
  {
    label: "ISOLATOR · KILLS",
    title: "5-band sound-system isolator",
    body: "Per-band kill, momentary punch-in, solo and gain trims across SUB·LOW·MID·HIGH·TOP. Adjustable crossovers, per-band VU, Flat Mode and Pure-Sub.",
    bands: ["SUB", "LOW", "MID", "HIGH", "TOP"],
  },
  {
    label: "DECKS A / B",
    title: "Dual decks + smart playlists",
    body: "Load MP3, M4A, WAV, AIFF or FLAC. Drag-drop playlists with search, queue and auto-advance, plus rewind modes, hot-cues, beat-loops and a crossfader with selectable curves.",
  },
  {
    label: "DUAL EQ",
    title: "10-band graphic + 4-band parametric",
    body: "A 10-band graphic EQ with shape presets stacked beside a 4-band parametric, wired through a single routing selector.",
  },
  {
    label: "REVERB",
    title: "Cavernous reverb processor",
    body: "Send/return, room, HF-damp, dry-wet, pre-delay and FREEZE for an infinite tail. Modulation, an interactive band-pass graph and a dedicated limiter.",
  },
  {
    label: "TAPE ECHO",
    title: "Type 1 / 2 tape delay",
    body: "Saturation, feedback, wow & flutter and ROBOT mode. Tempo-sync, interactive filter graph, sub-HP and its own limiter to tame runaway feedback.",
  },
  {
    label: "DUB FILTER",
    title: "Hands-free dub-wah",
    body: "HP/LP with cutoff and resonance, plus an auto-sweep LFO that rides the filter for you. Route it anywhere in the chain.",
  },
  {
    label: "DUB SIREN",
    title: "Floating dub siren",
    body: "Oscillator with two LFOs, bit-crusher, stereo auto-pan and a 12-slot preset bank. Echo and reverb sends in a detachable floating window.",
  },
  {
    label: "SAMPLER · 12",
    title: "12-slot sound-system kit",
    body: "Air horn, siren, gun-fingers, wheel-up, laser, sub-drop, horn-stab and more. Reverse, hold, drag-drop replace, FX sends and save/load sets as .zip.",
  },
  {
    label: "MASTER · METER · REC",
    title: "Master, metering & recorder",
    body: "Master gain, mono, dim and rumble-HP with peak metering. Three limiters with live gain-reduction. Capture the mix and export to WAV or AIFF.",
  },
];

/* ------------------------------------------------------------------ */
/*  Card shell — rack-unit panel with hover lift + accent edge.       */
/* ------------------------------------------------------------------ */
function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <article
      className={[
        "group relative flex flex-col rounded-xl border border-line bg-panel p-6 panel-sheen",
        "transition-all duration-200 ease-out",
        "hover:-translate-y-1 hover:border-accent/60",
        "hover:shadow-[0_18px_40px_-22px_var(--color-accent)]",
        className ?? "",
      ].join(" ")}
    >
      {children}
    </article>
  );
}

function CardHead({
  label,
  children,
}: {
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-muted transition-colors group-hover:text-accent">
        {label}
      </span>
      {children ?? (
        <Led
          color="muted"
          className="transition-colors group-hover:bg-accent group-hover:shadow-[0_0_8px_1px_var(--color-accent)]"
        />
      )}
    </div>
  );
}

export default function Features() {
  // First card spans 2 columns at lg as the lead feature.
  const [lead, ...rest] = features;

  return (
    <Section id="features" className="relative overflow-hidden">
      {/* faint rack grid behind the cards */}
      <div
        aria-hidden="true"
        className="bg-grid-fade pointer-events-none absolute inset-0 opacity-40"
      />

      <Container className="relative">
        {/* heading */}
        <header className="max-w-2xl">
          <Eyebrow led>The rack</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            One channel strip.{" "}
            <span className="text-accent">A full dubplate arsenal.</span>
          </h2>
          <p className="mt-4 text-pretty text-muted">
            Isolator, decks, two EQs, reverb, tape echo, dub filter, siren and a
            12-slot sampler — every module wired into a single signal path you
            can rebuild on the fly.
          </p>
        </header>

        {/* grid */}
        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* lead / spanning card — the isolator */}
          <Card className="sm:col-span-2">
            <CardHead label={lead.label}>
              <span className="inline-flex items-center gap-1.5">
                <Led color="accent" />
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
                  Live
                </span>
              </span>
            </CardHead>
            <h3 className="text-xl font-semibold tracking-tight">
              {lead.title}
            </h3>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
              {lead.body}
            </p>

            {/* mock 5-band VU strip */}
            {lead.bands ? (
              <div
                aria-hidden="true"
                className="mt-6 grid grid-cols-5 gap-2"
              >
                {lead.bands.map((band, i) => (
                  <div
                    key={band}
                    className="flex flex-col items-center gap-2 rounded-md border border-line bg-panel-2 px-2 py-3"
                  >
                    <span className="flex h-16 w-2 flex-col-reverse overflow-hidden rounded-full bg-bg">
                      <span
                        className={
                          i === 1 || i === 2
                            ? "w-full rounded-full bg-accent"
                            : "w-full rounded-full bg-accent-2/70"
                        }
                        style={{ height: `${[55, 82, 68, 40, 28][i]}%` }}
                      />
                    </span>
                    <span className="font-mono text-[10px] tracking-[0.15em] text-muted">
                      {band}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>

          {/* standard module cards */}
          {rest.map((f) => (
            <Card key={f.label}>
              <CardHead label={f.label} />
              <h3 className="text-lg font-semibold tracking-tight">
                {f.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {f.body}
              </p>
            </Card>
          ))}

          {/* MIDI — full-width feature-spanning card */}
          <Card className="sm:col-span-2 lg:col-span-3">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-xl">
                <CardHead label="TOTAL MIDI CONTROL" />
                <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">
                  Every knob and fader is mappable.
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  <Kbd>Cmd</Kbd> <span className="text-muted/60">+</span>{" "}
                  <Kbd>Shift</Kbd> <span className="text-muted/60">+</span> click
                  any control to MIDI-learn it. Pickup mode keeps moves
                  glitch-free, and you can save or load full mappings per rig.
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Pill accent>
                  <Led color="accent" /> MIDI-learn
                </Pill>
                <Pill>Pickup mode</Pill>
                <Pill>Save / load maps</Pill>
              </div>
            </div>
          </Card>
        </div>
      </Container>
    </Section>
  );
}
