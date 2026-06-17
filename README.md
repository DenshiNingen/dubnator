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

## Quick start

```bash
corepack enable                # provides pnpm
pnpm install                   # install the whole workspace

pnpm studio                    # run the app   → http://127.0.0.1:1420
pnpm web                       # run the site  → http://localhost:3000

pnpm build                     # build everything (turbo)
pnpm test                      # run the studio test suite
```

Per-app:

```bash
pnpm --filter @dubnator/studio dev      # app dev server (watch + live reload)
pnpm --filter @dubnator/studio test     # audio-engine / recorder / midi tests
pnpm --filter @dubnator/studio tauri:build   # build the desktop app locally (needs Rust)
```

## The rack

A five-band isolator (SUB·LOW·MID·HIGH·TOP) with kills, punch-in & solo · dual decks
with playlists, hot-cues and beat-loops · a 10-band graphic + 4-band parametric EQ ·
a reverb processor and a tape echo (each with an interactive band-pass graph and its
own limiter) · a dub filter with a hands-free auto-sweep · a dub siren · a 12-slot
sampler with a built-in sound-system kit · a WAV/AIFF recorder · and **total MIDI
control** — Cmd+Shift+click any knob or fader to MIDI-learn it.

## Deployment

**Web (Vercel).** Two projects from this one repo:

| Project | Root directory | Framework | Domain |
|---|---|---|---|
| dubnator-web | `apps/web` | Next.js (auto) | `dubnator.denshi.io` |
| dubnator-studio | `apps/studio` | Other (`vercel.json`) | `play.dubnator.denshi.io` |

Vercel detects the pnpm workspace and installs from the root; each project builds its
own subdirectory. The studio build (`node build.mjs`) emits static files to `dist/`.

**Desktop (GitHub Releases).** Push a tag `vX.Y.Z` → the `release-desktop` workflow
builds the Tauri app on Windows, macOS and Linux and attaches the installers to a
GitHub Release. The site's Download section links to the latest release.

## License

MIT — see [`LICENSE`](./LICENSE).
