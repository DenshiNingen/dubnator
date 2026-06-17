import { ImageResponse } from "next/og";

export const alt =
  "Dubnator — browser dub/reggae FX rack & sound-system channel strip";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Band colours mirror the app's isolator (SUB·LOW·MID·HIGH·TOP).
const BANDS: [string, string][] = [
  ["SUB", "#ef4444"],
  ["LOW", "#f59e0b"],
  ["MID", "#eab308"],
  ["HIGH", "#38bdf8"],
  ["TOP", "#22c55e"],
];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background:
            "radial-gradient(900px 500px at 50% -10%, #211410 0%, #0a0a0b 60%)",
          color: "#ececec",
          padding: "64px 72px",
          fontFamily: "monospace",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{ display: "flex", alignItems: "center", gap: 4, height: 26 }}
          >
            {[14, 24, 18, 26].map((h, i) => (
              <div
                key={i}
                style={{
                  width: 6,
                  height: h,
                  background: "#ff5a28",
                  borderRadius: 2,
                }}
              />
            ))}
          </div>
          <div style={{ fontSize: 26, letterSpacing: 6, color: "#8b919c" }}>
            DUB · REGGAE · SOUND-SYSTEM
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              display: "flex",
              fontSize: 112,
              fontWeight: 800,
              letterSpacing: -2,
            }}
          >
            <span>DUB</span>
            <span style={{ color: "#ff5a28" }}>NATOR</span>
          </div>
          <div style={{ fontSize: 34, color: "#b9bec7", maxWidth: 900 }}>
            Run the sound system in your browser — kills, tape echo, dub sirens
            and a full channel strip, all MIDI-mappable.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div style={{ display: "flex", gap: 10 }}>
            {BANDS.map(([label, color]) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    width: 92,
                    height: 12,
                    background: color,
                    borderRadius: 3,
                  }}
                />
                <div style={{ fontSize: 18, color: "#8b919c", letterSpacing: 3 }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 26, color: "#8b919c", letterSpacing: 3 }}>
            play.dubnator.denshi.io
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
