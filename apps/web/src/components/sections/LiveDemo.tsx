"use client";

import { useState } from "react";
import Image from "next/image";
import { Button, Container, Eyebrow, Led, Pill, Section } from "@/components/ui";

/* ------------------------------------------------------------------ */
/*  LiveDemo — "pull it up" band with a framed operator-console preview */
/*  Client component: the interactive iframe is mounted on demand only. */
/* ------------------------------------------------------------------ */
const demoUrl = process.env.NEXT_PUBLIC_DEMO_URL || "https://play.dubnator.denshi.io";

export default function LiveDemo() {
  const [live, setLive] = useState(false);

  return (
    <Section id="live-demo" className="relative overflow-hidden">
      {/* faint rack texture + accent glow framing */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-grid-fade opacity-[0.35]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-glow"
      />

      <Container className="relative">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <Eyebrow led>Live // In the browser</Eyebrow>
          <h2 className="mt-5 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            No install. Just press play.
          </h2>
          <p className="mt-5 text-pretty text-base leading-relaxed text-muted sm:text-lg">
            Step into the control tower. The full rack runs right here in the
            browser — every band, deck, echo and siren, zero download. Pull it
            up, drop the weight, run the riddim. Best with headphones, or patch
            it into the system and let the dance feel it.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button href={demoUrl} size="md">
              Launch the live rack <span aria-hidden="true">-&gt;</span>
            </Button>
            <Pill>
              <Led color="amber" /> No sign-up
            </Pill>
            <Pill>Free &amp; open-source</Pill>
          </div>
        </div>

        {/* -------------------------------------------------------------- */}
        {/*  Framed "screen" — browser chrome + live operator console      */}
        {/* -------------------------------------------------------------- */}
        <div className="relative mx-auto mt-14 max-w-5xl">
          {/* accent glow bloom behind the frame */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-x-8 -top-8 bottom-0 -z-10 rounded-[2rem] bg-accent/20 opacity-50 blur-3xl"
          />

          <div className="overflow-hidden rounded-xl border border-line bg-panel panel-sheen shadow-2xl shadow-black/60">
            {/* browser chrome bar */}
            <div className="flex items-center gap-3 border-b border-line bg-panel-2 px-4 py-2.5">
              <div
                aria-hidden="true"
                className="flex shrink-0 items-center gap-1.5"
              >
                <span className="size-3 rounded-full border border-line bg-panel" />
                <span className="size-3 rounded-full border border-line bg-panel" />
                <span className="size-3 rounded-full border border-line bg-panel" />
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-bg px-3 py-1.5">
                <Led color={live ? "accent" : "muted"} className="size-1.5" />
                <span className="truncate font-mono text-xs text-muted">
                  play.dubnator.denshi.io
                </span>
              </div>
              {/* interactive toggle: mounts the live iframe only on click */}
              {live ? (
                <span className="hidden shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-accent sm:inline-flex">
                  <Led color="accent" className="size-1.5" /> On air
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setLive(true)}
                  className="hidden shrink-0 items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted panel-sheen transition-colors duration-150 hover:border-accent/60 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:inline-flex"
                >
                  <Led color="amber" className="size-1.5" /> Load interactive
                  preview
                </button>
              )}
            </div>

            {/* console surface — poster by default, live iframe on demand */}
            <div className="relative aspect-[2700/2060] bg-bg">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-20 bg-scanlines opacity-[0.04]"
              />

              {live ? (
                <iframe
                  src={demoUrl}
                  title="Dubnator live"
                  className="absolute inset-0 z-10 size-full border-0"
                  allow="autoplay; microphone; midi"
                />
              ) : (
                <>
                  {/* reliable poster: the real rack screenshot fills the frame */}
                  <Image
                    src="/shots/rack.png"
                    alt="The Dubnator operator console — 5-band isolator, tape echo, twin decks and crossfader running in the browser."
                    width={2700}
                    height={2060}
                    sizes="(min-width: 1024px) 64rem, (min-width: 640px) 90vw, 100vw"
                    priority={false}
                    className="absolute inset-0 z-0 size-full object-cover"
                  />

                  {/* darkening veil so the overlay stays legible */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 z-10 bg-bg/55"
                  />

                  {/* centered primary overlay — launch the live rack */}
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 p-6 text-center">
                    <Button
                      href={demoUrl}
                      size="md"
                      aria-label="Launch the live rack in a new tab"
                    >
                      Launch the live rack{" "}
                      <span aria-hidden="true">-&gt;</span>
                    </Button>
                    <button
                      type="button"
                      onClick={() => setLive(true)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel/80 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted panel-sheen backdrop-blur-sm transition-colors duration-150 hover:border-accent/60 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                    >
                      <Led color="amber" className="size-1.5" /> Or load
                      interactive preview here
                    </button>
                    <p className="max-w-sm text-pretty font-mono text-[10px] uppercase leading-relaxed tracking-[0.15em] text-muted">
                      The full rack, in the dance — best with headphones or on a
                      system.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
