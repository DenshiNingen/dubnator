#!/usr/bin/env python3
"""Inspect ISO-BMFF boxes and compressed samples without decoding audio."""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import math
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator


CONTAINERS = {
    b"moov", b"trak", b"mdia", b"minf", b"stbl", b"dinf", b"edts",
    b"udta", b"ilst", b"moof", b"traf", b"mfra", b"mvex",
}
ENCRYPTION_BOXES = {"sinf", "schm", "schi", "tenc", "senc", "saiz", "saio", "pssh"}


@dataclass(frozen=True)
class Box:
    kind: str
    offset: int
    size: int
    header_size: int
    path: str

    @property
    def payload_offset(self) -> int:
        return self.offset + self.header_size

    @property
    def end(self) -> int:
        return self.offset + self.size


def u32(data: bytes, offset: int) -> int:
    return struct.unpack_from(">I", data, offset)[0]


def u64(data: bytes, offset: int) -> int:
    return struct.unpack_from(">Q", data, offset)[0]


def walk_boxes(data: bytes, start: int = 0, end: int | None = None, parent: str = "") -> Iterator[Box]:
    end = len(data) if end is None else min(end, len(data))
    cursor = start
    while cursor + 8 <= end:
        size = u32(data, cursor)
        kind_bytes = data[cursor + 4:cursor + 8]
        header_size = 8
        if size == 1:
            if cursor + 16 > end:
                return
            size = u64(data, cursor + 8)
            header_size = 16
        elif size == 0:
            size = end - cursor
        if size < header_size or cursor + size > end:
            return
        kind = kind_bytes.decode("latin-1")
        path = f"{parent}/{kind}" if parent else kind
        box = Box(kind, cursor, size, header_size, path)
        yield box
        if kind_bytes in CONTAINERS:
            yield from walk_boxes(data, box.payload_offset, box.end, path)
        elif kind_bytes == b"meta" and box.payload_offset + 4 <= box.end:
            yield from walk_boxes(data, box.payload_offset + 4, box.end, path)
        elif kind_bytes == b"stsd":
            yield from walk_stsd(data, box)
        cursor += size


def walk_stsd(data: bytes, stsd: Box) -> Iterator[Box]:
    cursor = stsd.payload_offset + 8  # version/flags + entry count
    while cursor + 8 <= stsd.end:
        size = u32(data, cursor)
        kind = data[cursor + 4:cursor + 8].decode("latin-1")
        if size < 36 or cursor + size > stsd.end:
            return
        entry = Box(kind, cursor, size, 8, f"{stsd.path}/{kind}")
        yield entry
        # ISO audio sample entry is 28 bytes after its ordinary box header.
        yield from walk_boxes(data, cursor + 36, cursor + size, entry.path)
        cursor += size


def find_one(boxes: list[Box], kind: str) -> Box:
    matches = [box for box in boxes if box.kind == kind]
    if len(matches) != 1:
        raise ValueError(f"expected one {kind} box, found {len(matches)}")
    return matches[0]


def sample_sizes(data: bytes, box: Box) -> list[int]:
    payload = box.payload_offset
    default_size = u32(data, payload + 4)
    count = u32(data, payload + 8)
    if default_size:
        return [default_size] * count
    return [u32(data, payload + 12 + index * 4) for index in range(count)]


def chunk_offsets(data: bytes, box: Box) -> list[int]:
    payload = box.payload_offset
    count = u32(data, payload + 4)
    width = 8 if box.kind == "co64" else 4
    unpack = u64 if width == 8 else u32
    return [unpack(data, payload + 8 + index * width) for index in range(count)]


def samples_per_chunks(data: bytes, box: Box, chunk_count: int) -> list[int]:
    payload = box.payload_offset
    count = u32(data, payload + 4)
    entries = [
        (u32(data, payload + 8 + i * 12), u32(data, payload + 12 + i * 12))
        for i in range(count)
    ]
    result = []
    for chunk_number in range(1, chunk_count + 1):
        active = entries[0]
        for entry in entries:
            if entry[0] > chunk_number:
                break
            active = entry
        result.append(active[1])
    return result


def sample_ranges(data: bytes, boxes: list[Box]) -> list[tuple[int, int]]:
    sizes = sample_sizes(data, find_one(boxes, "stsz"))
    offset_boxes = [box for box in boxes if box.kind in ("stco", "co64")]
    if len(offset_boxes) != 1:
        raise ValueError(f"expected one chunk-offset box, found {len(offset_boxes)}")
    offsets = chunk_offsets(data, offset_boxes[0])
    distribution = samples_per_chunks(data, find_one(boxes, "stsc"), len(offsets))
    ranges = []
    sample_index = 0
    for chunk_offset, count in zip(offsets, distribution):
        cursor = chunk_offset
        for _ in range(count):
            if sample_index >= len(sizes):
                raise ValueError("chunk table describes more samples than stsz")
            size = sizes[sample_index]
            ranges.append((cursor, size))
            cursor += size
            sample_index += 1
    if sample_index != len(sizes):
        raise ValueError(f"mapped {sample_index} of {len(sizes)} samples")
    return ranges


def entropy(payload: bytes) -> float:
    if not payload:
        return 0.0
    counts = collections.Counter(payload)
    length = len(payload)
    return -sum((count / length) * math.log2(count / length) for count in counts.values())


def inspect(path: Path, sample_limit: int) -> dict:
    data = path.read_bytes()
    boxes = list(walk_boxes(data))
    ranges = sample_ranges(data, boxes)
    aligned = {
        str(block_size): sum(size % block_size == 0 for _, size in ranges)
        for block_size in (8, 16, 32)
    }
    selected = ranges[:sample_limit]
    samples = []
    for index, (offset, size) in enumerate(selected):
        payload = data[offset:offset + size]
        samples.append({
            "index": index,
            "offset": offset,
            "size": size,
            "prefix_hex": payload[:24].hex(),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "entropy_bits_per_byte": round(entropy(payload), 5),
        })
    kinds = collections.Counter(box.kind for box in boxes)
    return {
        "path": str(path),
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "boxes": [
            {"path": box.path, "offset": box.offset, "size": box.size}
            for box in boxes
        ],
        "box_counts": dict(sorted(kinds.items())),
        "encryption_boxes": sorted(set(kinds) & ENCRYPTION_BOXES),
        "sample_count": len(ranges),
        "aligned_sample_counts": aligned,
        "sample_size": {
            "min": min(size for _, size in ranges),
            "max": max(size for _, size in ranges),
            "mean": round(sum(size for _, size in ranges) / len(ranges), 3),
        },
        "samples": samples,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("file", type=Path)
    parser.add_argument("--samples", type=int, default=8)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = inspect(args.file, args.samples)
    encoded = json.dumps(result, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    else:
        print(encoded)


if __name__ == "__main__":
    main()
