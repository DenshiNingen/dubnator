#!/bin/sh
set -eu

fixtures_json=$1
generated=$2
work=$3

python3 - "$fixtures_json" <<'PY' | while IFS= read -r stem; do
import json, sys
for fixture in json.load(open(sys.argv[1])):
    print(fixture["stem_path"])
PY
  base=$(basename "$stem" .stems | tr ' ' '_')
  log="$generated/${base}-decoders.log"
  out="$work/${base}.wav"
  decrypted="$work/${base}-decrypted.m4a"
  {
    echo "FILE: $stem"
    echo "=== ffprobe ==="
    ffprobe -v warning -show_format -show_streams "$stem" || true
    echo "=== ffmpeg decode ==="
    ffmpeg -hide_banner -nostdin -y -v warning -i "$stem" -t 5 -c:a pcm_f32le "$out" || true
    if [ -f "$out" ]; then
      ffprobe -v error -show_entries format=duration,size -show_entries stream=channels,sample_rate -of default=nw=1 "$out" || true
    fi
    echo "=== macOS afinfo ==="
    afinfo "$stem" || true
    echo "=== recovered AES-ECB decode ==="
    python3 "$(dirname "$0")/decrypt_stems.py" "$stem" "$decrypted"
    ffprobe -v error -show_entries stream=codec_name,profile,channels,sample_rate,duration \
      -of default=nw=1 "$decrypted"
    ffmpeg -hide_banner -nostdin -v error -i "$decrypted" -f null -
  } >"$log" 2>&1
done
