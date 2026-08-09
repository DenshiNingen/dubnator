#!/usr/bin/env python3
"""Measure block-cipher signatures across Engine DJ .stems access units."""

from __future__ import annotations

import argparse
import collections
import json
from pathlib import Path

from inspect_mp4 import sample_ranges, walk_boxes


def analyze(paths: list[Path], top: int = 16) -> dict:
    first_blocks: collections.Counter[str] = collections.Counter()
    last_blocks: collections.Counter[str] = collections.Counter()
    sample_count = 0
    aligned_16 = 0
    files = []

    for path in paths:
        data = path.read_bytes()
        ranges = sample_ranges(data, list(walk_boxes(data)))
        file_aligned = 0
        for offset, size in ranges:
            payload = data[offset:offset + size]
            sample_count += 1
            if size % 16 == 0:
                aligned_16 += 1
                file_aligned += 1
            if len(payload) >= 16:
                first_blocks[payload[:16].hex()] += 1
                last_blocks[payload[-16:].hex()] += 1
        files.append({
            "path": str(path),
            "samples": len(ranges),
            "aligned_16": file_aligned,
        })

    def most_common(counter: collections.Counter[str]) -> list[dict]:
        return [{"block": block, "count": count} for block, count in counter.most_common(top)]

    return {
        "file_count": len(paths),
        "sample_count": sample_count,
        "aligned_16": aligned_16,
        "aligned_16_ratio": aligned_16 / sample_count if sample_count else 0,
        "unique_first_blocks": len(first_blocks),
        "unique_last_blocks": len(last_blocks),
        "common_first_blocks": most_common(first_blocks),
        "common_last_blocks": most_common(last_blocks),
        "files": files,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--top", type=int, default=16)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    paths: list[Path] = []
    for supplied in args.paths:
        if supplied.is_dir():
            paths.extend(sorted(supplied.glob("*.stems")))
        elif supplied.is_file():
            paths.append(supplied)
        else:
            raise FileNotFoundError(supplied)
    result = analyze(paths, args.top)
    encoded = json.dumps(result, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    else:
        print(encoded)


if __name__ == "__main__":
    main()
