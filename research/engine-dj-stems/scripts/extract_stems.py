#!/usr/bin/env python3
"""Decrypt an Engine DJ stems file and split its four stereo AAC buses."""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

from decrypt_stems import (
    ENGINE_DJ_STEMS_AES_KEY,
    decrypt_samples,
    parse_key,
    rebuilt_mp4,
)
from inspect_mp4 import walk_boxes


# File channel-pair order. Engine's UI/pad order is different and must be
# remapped to Vocals, Melody, Bass, Drums by consumers.
STEM_NAMES = ("vocals", "bass", "drums", "melody")


def extract(source: Path, destination: Path, key: bytes, ffmpeg: str) -> list[Path]:
    data = source.read_bytes()
    boxes = list(walk_boxes(data))
    samples = decrypt_samples(data, boxes, key)
    destination.mkdir(parents=True, exist_ok=True)
    decoded = destination / "decoded-8ch.m4a"
    decoded.write_bytes(rebuilt_mp4(data, boxes, samples))

    outputs = [destination / f"{name}.wav" for name in STEM_NAMES]
    filter_graph = ";".join(
        f"[0:a]pan=stereo|c0=c{index * 2}|c1=c{index * 2 + 1}[{name}]"
        for index, name in enumerate(STEM_NAMES)
    )
    command = [ffmpeg, "-v", "error", "-y", "-i", str(decoded), "-filter_complex", filter_graph]
    for name, output in zip(STEM_NAMES, outputs):
        command.extend(["-map", f"[{name}]", "-c:a", "pcm_f32le", str(output)])
    subprocess.run(command, check=True)
    return outputs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--key-hex", type=parse_key, default=ENGINE_DJ_STEMS_AES_KEY)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    args = parser.parse_args()
    outputs = extract(args.input, args.output_dir, args.key_hex, args.ffmpeg)
    print("extracted " + ", ".join(str(path) for path in outputs))


if __name__ == "__main__":
    main()
