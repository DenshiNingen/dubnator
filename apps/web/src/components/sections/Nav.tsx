"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Container, Led } from "@/components/ui";

const DEMO_URL = "https://play.dubnator.denshi.io";
const REPO_URL = "https://github.com/DenshiNingen/dubnator";

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#for-the-dance", label: "Culture" },
  { href: "#live-demo", label: "Session" },
  { href: "#download", label: "Download" },
] as const;

/* ------------------------------------------------------------------ */
/*  Wordmark — mono DUBNATOR with a 3-bar EQ glyph + accent LED        */
/* ------------------------------------------------------------------ */
function Wordmark() {
  return (
    <Link
      href="/"
      aria-label="Dubnator — home"
      className="group inline-flex items-center gap-2.5 focus-visible:outline-none"
    >
      <span
        aria-hidden="true"
        className="flex h-5 items-end gap-[3px] rounded-[3px] border border-line bg-panel-2 px-1.5 py-1 panel-sheen"
      >
        <span className="w-[3px] rounded-full bg-accent transition-[height] duration-300 ease-out h-1.5 group-hover:h-3" />
        <span className="w-[3px] rounded-full bg-accent transition-[height] duration-300 ease-out h-3 group-hover:h-1.5" />
        <span className="w-[3px] rounded-full bg-accent-2 transition-[height] duration-300 ease-out h-2 group-hover:h-2.5" />
      </span>
      <span className="font-mono text-[15px] font-bold uppercase tracking-[0.22em] text-text">
        Dub<span className="text-accent">nator</span>
      </span>
    </Link>
  );
}

export default function Nav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-bg/70 backdrop-blur-md backdrop-saturate-150">
      <Container className="flex h-14 items-center justify-between gap-4">
        {/* Left — wordmark */}
        <Wordmark />

        {/* Center — desktop anchor links */}
        <nav
          aria-label="Primary"
          className="hidden items-center gap-1 md:flex"
        >
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="rounded-md px-3 py-2 font-mono text-xs font-medium uppercase tracking-[0.15em] text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:text-text"
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* Right — actions (desktop) */}
        <div className="hidden items-center gap-2 md:flex">
          <Button href={REPO_URL} variant="ghost" size="sm">
            GitHub
          </Button>
          <Button href={DEMO_URL} variant="primary" size="sm">
            <Led className="!size-1.5 !bg-bg !shadow-none" />
            Pull it up
          </Button>
        </div>

        {/* Right — mobile: launch + menu toggle */}
        <div className="flex items-center gap-2 md:hidden">
          <Button href={DEMO_URL} variant="primary" size="sm">
            Launch
          </Button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="inline-flex size-9 items-center justify-center rounded-md border border-line bg-panel text-text transition-colors hover:border-accent hover:text-accent focus-visible:outline-none panel-sheen"
          >
            <span aria-hidden="true" className="relative block h-3 w-4">
              <span
                className={`absolute left-0 block h-[1.5px] w-full bg-current transition-all duration-200 ${
                  open ? "top-1.5 rotate-45" : "top-0"
                }`}
              />
              <span
                className={`absolute left-0 top-1.5 block h-[1.5px] w-full bg-current transition-opacity duration-200 ${
                  open ? "opacity-0" : "opacity-100"
                }`}
              />
              <span
                className={`absolute left-0 block h-[1.5px] w-full bg-current transition-all duration-200 ${
                  open ? "top-1.5 -rotate-45" : "top-3"
                }`}
              />
            </span>
          </button>
        </div>
      </Container>

      {/* Mobile drawer */}
      <div
        id="mobile-nav"
        className={`overflow-hidden border-t border-line bg-bg/95 backdrop-blur-md transition-[max-height] duration-300 ease-out md:hidden ${
          open ? "max-h-80" : "max-h-0 border-t-transparent"
        }`}
      >
        <Container className="flex flex-col gap-1 py-3">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-md px-3 py-3 font-mono text-sm font-medium uppercase tracking-[0.15em] text-muted transition-colors hover:bg-panel hover:text-text focus-visible:outline-none"
            >
              <Led color="muted" className="!size-1.5" />
              {label}
            </Link>
          ))}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button
              href={REPO_URL}
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              GitHub
            </Button>
            <Button
              href={DEMO_URL}
              variant="primary"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Pull it up
            </Button>
          </div>
        </Container>
      </div>
    </header>
  );
}
