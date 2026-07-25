# Dubnator

**A browser-based dub / reggae sound-system FX rack & channel strip.** Two decks, a
five-band isolator, dual EQ, reverb, tape echo, a dub siren, a sampler, a recorder —
fully MIDI-mappable, running entirely in your browser on Web Audio, and also shipped
as a native desktop app.

- 🎚️ **Live demo:** https://play.dubnator.denshi.io
- 🌐 **Project site:** https://dubnator.denshi.io
- 💾 **Desktop app:** [latest release](../../releases/latest) (Windows · macOS · Linux)

> Free & open-source. All audio is processed locally — nothing leaves your machine.

---

## Monorepo

```
dubnator/
├─ apps/
│  ├─ web/     → Next.js marketing site        (deploys to dubnator.denshi.io)
│  └─ studio/  → the Dubnator app (esbuild +    (deploys to play.dubnator.denshi.io)
│                Web Audio) + Tauri desktop shell
├─ .github/workflows/   → CI + desktop release pipeline
├─ turbo.json · pnpm-workspace.yaml
```

Tooling: **pnpm** workspaces + **Turborepo**. Node ≥ 20.

The studio keeps its compatibility-facing browser globals while separating the
main concerns into focused sources: `audio-codecs.js` owns AIFF/WAV parsing and
encoding, `audio-engine.js` owns the Web Audio graph, and the JSX files own
controls, floating windows, playlists, the keyboard map and the main rack UI.
The MIDI catalog is data-only in `midi-controls.js`. Production builds vendor
all runtime dependencies and generate a content-versioned offline service
worker; neither app requires a font CDN.

## Quick start

```bash
corepack enable                # provides pnpm
pnpm install                   # install the whole workspace

pnpm studio                    # run the app   → http://127.0.0.1:1420
pnpm web                       # run the site  → http://localhost:3000

pnpm build                     # build everything (turbo)
pnpm test                      # run the studio test suite
pnpm lint                      # lint both applications
```

Per-app:

```bash
pnpm --filter @dubnator/studio dev      # app dev server (watch + live reload)
pnpm --filter @dubnator/studio build
pnpm --filter @dubnator/studio test     # engine / recorder / MIDI / PWA tests
pnpm --filter @dubnator/studio tauri:build   # build the desktop app locally (needs Rust)
```

`pnpm test` builds first, then checks the studio engine, codecs, MIDI and keyboard
mapping, validates the generated PWA shell, and smoke-tests the statically
rendered marketing site. CI additionally runs `cargo fmt --check` and
`cargo check --locked` for the native shell.

## The rack

A five-band isolator (SUB·LOW·MID·HIGH·TOP) with kills, punch-in & solo · dual decks
with playlists, hot-cues and beat-loops · a 10-band graphic + 4-band parametric EQ ·
a reverb processor and a tape echo (each with an interactive band-pass graph and its
own limiter) · a dub filter with a hands-free auto-sweep · a dub siren · a 12-slot
sampler with a built-in sound-system kit · a WAV/AIFF recorder · and **total MIDI
control** — Cmd+Shift+click any knob or fader to MIDI-learn it.

## Two Launchpad Mini MK3s

Dubnator has a built-in, bidirectional surface for two Novation Launchpad Mini
MK3s. It uses each device's **MIDI** port (not its DAW port), enters Programmer
Mode automatically, and restores Live Mode when the app closes.

- Give the two units different Device IDs: hold **User** while plugging each one
  in, then select a different pad in the top two rows.
- In the native app, the controllers are detected automatically. In the browser,
  open **MIDI → Enable MIDI** once to grant Web MIDI + SysEx access.
- The first unit is **MIX / DECKS / INPUTS / ISOLATOR / SIREN / MASTER**; the
  second is **ECHO / REVERB / FILTER / SAMPLES / ADVANCED ISOLATOR / EQ**.
- The eight top buttons select pages. Grid columns are LED faders; the remaining
  grid and side pads are stateful actions. Use **MIDI → Swap L/R** if the physical
  order is reversed.
- Open **Help → Launchpad Mini MK3 layouts** for the interactive 8×8 maps and
  full labels for every page.

The surface covers all 200 catalogued performance controls and keeps faders,
toggles, selectors, transport, sample/siren pads and active pages synchronized
with the UI.

## Deployment

**Web (Vercel).** Two projects from this one repo:

| Project | Root directory | Framework | Domain |
|---|---|---|---|
| dubnator-web | `apps/web` | Next.js (auto) | `dubnator.denshi.io` |
| dubnator-studio | `apps/studio` | Other (`vercel.json`) | `play.dubnator.denshi.io` |

Vercel detects the pnpm workspace and installs from the root; each project builds its
own subdirectory. The studio build (`node build.mjs`) emits static files to `dist/`.
The repository root also contains a Studio compatibility entry point and Vercel
configuration, so an existing Studio project configured with the repository root
continues to build to `apps/studio/dist`. Setting its Root Directory to `apps/studio`
remains the recommended configuration.

**Desktop (GitHub Releases).** Push a tag `vX.Y.Z` → the `release-desktop` workflow
builds the Tauri app on Windows, macOS and Linux and attaches the installers to a
GitHub Release. The site's Download section links to the latest release.

## License

MIT — see [`LICENSE`](./LICENSE).
