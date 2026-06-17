import Image from "next/image";
import {
  Button,
  Container,
  Eyebrow,
  Kbd,
  Led,
  Pill,
  Section,
} from "@/components/ui";

/* ------------------------------------------------------------------ */
/*  Hero — the control tower. Copy + the real rack screenshot.         */
/* ------------------------------------------------------------------ */
const DEMO_URL = "https://play.dubnator.denshi.io";

const TRUST = [
  "Free & open-source",
  "Web Audio",
  "No install",
  "Win / Mac / Linux",
] as const;

export default function Hero() {
  return (
    <Section
      id="top"
      className="relative overflow-hidden pt-28 sm:pt-32"
      aria-labelledby="hero-heading"
    >
      {/* faint rack texture + radial glow behind everything */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-grid-fade opacity-60"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-line to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[42rem] w-[42rem] -translate-x-1/2 rounded-full bg-accent/10 blur-[120px]"
      />

      <Container className="relative">
        <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-12">
          {/* -------------------------------------------------------- */}
          {/*  Copy column                                             */}
          {/* -------------------------------------------------------- */}
          <div className="max-w-xl">
            <Eyebrow led>DUB / REGGAE FX RACK · CHANNEL STRIP · LIVE</Eyebrow>

            <h1
              id="hero-heading"
              className="mt-6 text-balance font-sans text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl"
            >
              Run the riddim{" "}
              <span className="text-accent">in your browser.</span>
            </h1>

            <p className="mt-6 text-pretty text-base leading-relaxed text-muted sm:text-lg">
              A full sound-system control tower for selectas and dub
              controllers — five-band kills, tape echo, dub sirens, spring-style
              reverb and a hands-free dub filter. No DAW, no plugins. Open a tab,
              drop the weight and pull it up.
            </p>

            {/* CTAs */}
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button href={DEMO_URL} size="md">
                Try it live
              </Button>
              <Button href="#download" variant="ghost" size="md">
                Download the app
              </Button>
            </div>

            {/* learn hint */}
            <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1.5 font-mono text-[11px] uppercase tracking-[0.15em] text-muted">
              <Led color="amber" />
              <span>MIDI-learn anything —</span>
              <span className="inline-flex items-center gap-1">
                <Kbd>⌘</Kbd>
                <Kbd>⇧</Kbd>
                <span className="text-muted/70">+ click a knob</span>
              </span>
            </p>

            {/* trust row */}
            <ul className="mt-8 flex flex-wrap items-center gap-2.5">
              {TRUST.map((t) => (
                <li key={t}>
                  <Pill>{t}</Pill>
                </li>
              ))}
            </ul>
          </div>

          {/* -------------------------------------------------------- */}
          {/*  The real rack — screenshot in a sleek device frame      */}
          {/* -------------------------------------------------------- */}
          <RackDevice />
        </div>
      </Container>
    </Section>
  );
}

/* ================================================================== */
/*  RackDevice — the live screenshot framed as a dark hardware unit   */
/* ================================================================== */
function RackDevice() {
  return (
    <div className="relative mx-auto w-full max-w-2xl select-none">
      {/* accent glow puddle bleeding out from behind the device */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-8 -z-10 rounded-[2.5rem] bg-accent/10 blur-[80px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-10 left-1/2 -z-10 h-40 w-3/4 -translate-x-1/2 rounded-full bg-accent/20 blur-[90px]"
      />

      {/* the device — a touch of perspective tilt, settles flat on mobile */}
      <div className="[perspective:2000px]">
        <div className="relative rounded-2xl border border-line bg-panel panel-sheen p-2.5 shadow-[0_50px_100px_-32px_rgba(0,0,0,0.95)] transition-transform duration-500 will-change-transform sm:p-3 lg:[transform:rotateY(-7deg)_rotateX(2deg)] lg:hover:[transform:rotateY(-3deg)_rotateX(1deg)]">
          {/* top frame strip — brand + LIVE status chip */}
          <div className="flex items-center justify-between px-1.5 pb-2.5 pt-1">
            <div className="flex items-center gap-2">
              <span className="size-2.5 rounded-full border border-line bg-bg" />
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.3em] text-muted">
                DUBNATOR · CONTROL TOWER
              </span>
            </div>

            {/* LIVE chip */}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-[9px] font-medium uppercase tracking-[0.25em] text-accent">
              <Led color="accent" />
              LIVE
            </span>
          </div>

          {/* the screen itself */}
          <div className="relative overflow-hidden rounded-xl border border-line bg-bg shadow-[inset_0_0_0_1px_rgba(0,0,0,0.4)]">
            <Image
              src="/shots/rack.png"
              alt="Dubnator's live FX rack and channel strip running in a browser — five-band kills, tape echo, dub sirens and a hands-free dub filter."
              width={2700}
              height={2060}
              priority
              sizes="(min-width: 1024px) 42rem, (min-width: 640px) 90vw, 100vw"
              className="h-auto w-full"
            />

            {/* faint scanline + screen sheen over the shot */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-scanlines opacity-[0.06]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-bg/20 via-transparent to-accent/[0.04]"
            />
          </div>

          {/* bottom frame strip — session readout */}
          <div className="flex items-center justify-between px-1.5 pb-1 pt-2.5">
            <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.2em] text-muted">
              <Led color="amber" />
              IN THE DANCE
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted/70">
              FX-01 · ISOLATOR
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
