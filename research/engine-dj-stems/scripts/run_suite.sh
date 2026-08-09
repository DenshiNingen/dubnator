#!/bin/sh
set -eu

volume=${1:-/Volumes/ELECTRON}
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
generated="$root/reports/generated"
work="$root/work"
mkdir -p "$generated" "$work"

python3 "$root/scripts/catalog.py" "$volume" --output "$generated/catalog.json"

python3 - "$generated/catalog.json" "$generated" "$root" <<'PY'
import json
import subprocess
import sys
from pathlib import Path

catalog_path, generated_path, root_path = map(Path, sys.argv[1:])
catalog = json.loads(catalog_path.read_text())
tracks = catalog["tracks"]
if not tracks:
    raise SystemExit("No matched .stems files found")

# Exercise small, median and large files instead of cherry-picking one fixture.
ordered = sorted(tracks, key=lambda item: item["stem_bytes"])
fixtures = [ordered[0], ordered[len(ordered) // 2], ordered[-1]]
known = next((item for item in tracks if item["title"] == "Hibarnan"), tracks[0])
if known not in fixtures:
    fixtures.append(known)

summary = []
for fixture in fixtures:
    stem = Path(fixture["stem_path"])
    slug = f'{fixture["origin_track_id"]}-{stem.stem.split(" ", 1)[1]}'
    inspection = generated_path / f"{slug}-mp4.json"
    subprocess.run([
        sys.executable, str(root_path / "scripts" / "inspect_mp4.py"),
        str(stem), "--samples", "16", "--output", str(inspection),
    ], check=True)
    summary.append({
        "title": fixture["title"],
        "artist": fixture["artist"],
        "stem_path": str(stem),
        "original_path": fixture["original_path"],
        "inspection": str(inspection),
    })
(generated_path / "fixtures.json").write_text(json.dumps(summary, indent=2) + "\n")
PY

python3 -m unittest discover -s "$root/tests" -v
python3 "$root/scripts/analyze_cipher.py" \
  "$volume/Engine Library/Stems" \
  --output "$generated/cipher.json"
python3 "$root/scripts/validate_corpus.py" \
  "$volume/Engine Library/Stems" \
  --output "$generated/decryption-validation.json"
"$root/scripts/probe_decoders.sh" "$generated/fixtures.json" "$generated" "$work"

echo "Reports: $generated"
