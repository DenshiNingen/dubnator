import type { ReactNode } from "react";
import Image from "next/image";
import {
  Container,
  Section,
  Eyebrow,
  Button,
  Pill,
  Led,
} from "@/components/ui";

/* ------------------------------------------------------------------ */
/*  ForTheDance — culture / positioning band.                          */
/*  Speaks straight to selectas, dub controllers and sound-system      */
/*  operators: Dubnator is the control tower for the session.          */
/* ------------------------------------------------------------------ */

const PLAY_URL = "https://play.dubnator.denshi.io";

type ValuePoint = {
  label: string;
  title: string;
  body: string;
};

const points: ValuePoint[] = [
  {
    label: "ONE TAB · WHOLE RIG",
    title: "Run the riddim from the control tower",
    body: "Isolator, decks, EQs, echo and siren live in a single browser tab. Pull it up, lick it back and drop the weight without ever leaving the session.",
  },
  {
    label: "HANDS-ON · MIDI",
    title: "Map your controller, work it live",
    body: "MIDI-learn every knob and fader to your own gear. Pickup mode keeps the moves glitch-free so you ride the dance hands-on, eyes up.",
  },
  {
    label: "PORTABLE · PRESETS",
    title: "Carry your dubplates anywhere",
    body: "Sampler kits, FX presets and full MIDI maps save and load as files. Walk into any dance, load your set and run it like home turf.",
  },
  {
    label: "BUILT FOR THE WEIGHT",
    title: "Made by people who love the bass",
    body: "No filler, no fake VU eye-candy — every module earns its place in the chain. Engineered by operators who care about sub-pressure and feel.",
  },
];

const tags = [
  "SELECTA-READY",
  "DUB CONTROLLER",
  "FULL MIDI MAP",
  "DUBPLATE-PORTABLE",
];

function PointCard({
  label,
  title,
  body,
}: ValuePoint & { children?: ReactNode }) {
  return (
    <article className="group relative flex flex-col rounded-xl border border-line bg-panel p-6 panel-sheen transition-colors duration-200 hover:border-accent/60">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-muted transition-colors group-hover:text-accent">
          {label}
        </span>
        <Led
          color="muted"
          className="transition-colors group-hover:bg-accent group-hover:shadow-[0_0_8px_1px_var(--color-accent)]"
        />
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
    </article>
  );
}

export default function ForTheDance() {
  return (
    <Section id="for-the-dance" className="relative overflow-hidden">
      {/* warm rack glow + faint grid behind the band */}
      <div
        aria-hidden="true"
        className="bg-glow pointer-events-none absolute inset-0 opacity-60"
      />
      <div
        aria-hidden="true"
        className="bg-grid-fade pointer-events-none absolute inset-0 opacity-30"
      />

      <Container className="relative">
        {/* heading + supporting screenshot */}
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <header className="max-w-xl">
            <Eyebrow led>For the dance</Eyebrow>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              The control tower for{" "}
              <span className="text-accent">selectas, dub controllers</span> and
              sound-system operators.
            </h2>
            <p className="mt-4 text-pretty text-muted">
              Dubnator puts the whole sound-system in front of you — isolator,
              decks, dub FX and siren wired into one signal path. Built to be
              run live, in the dance, with the weight pushed all the way up.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button href={PLAY_URL} variant="primary" size="md">
                Pull it up
              </Button>
              <Button href={PLAY_URL} variant="ghost" size="md">
                Step in the session
              </Button>
            </div>

            {/* culture spec tags */}
            <ul className="mt-6 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <li key={tag}>
                  <Pill>{tag}</Pill>
                </li>
              ))}
            </ul>
          </header>

          {/* the rack — premium framed screenshot */}
          <figure className="relative">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-4 rounded-2xl bg-accent/10 blur-2xl"
            />
            <div className="relative overflow-hidden rounded-xl border border-line bg-panel-2 p-2 panel-sheen shadow-[0_30px_70px_-30px_var(--color-accent)]">
              <div className="mb-2 flex items-center gap-2 px-1">
                <Led color="accent" />
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
                  In the dance
                </span>
                <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                  THE RACK
                </span>
              </div>
              <Image
                src="/shots/rack.png"
                alt="The Dubnator rack — isolator, dual decks, EQs, reverb, tape echo and dub siren laid out as a single hardware-style channel strip."
                width={2700}
                height={2060}
                sizes="(min-width: 1024px) 42rem, (min-width: 640px) 90vw, 100vw"
                className="h-auto w-full rounded-md border border-line"
              />
            </div>
          </figure>
        </div>

        {/* value points */}
        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {points.map((p) => (
            <PointCard key={p.label} {...p} />
          ))}
        </div>
      </Container>
    </Section>
  );
}
