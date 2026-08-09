#!/usr/bin/env python3
"""Decrypt per-access-unit AES-ECB payloads and rebuild an Engine stems MP4.

This tool deliberately requires a caller-supplied key. It never guesses a key,
and it refuses to write output unless every AAC access unit has valid PKCS#7
padding. The rebuilt file keeps the original MP4 metadata while updating sample
sizes, chunk offsets, and the media-data payload.
"""

from __future__ import annotations

import argparse
import struct
from pathlib import Path

from Crypto.Cipher import AES

from inspect_mp4 import (
    Box,
    chunk_offsets,
    find_one,
    sample_ranges,
    samples_per_chunks,
    walk_boxes,
)


# Engine DJ Desktop 5.0.0 constructs this key at runtime from bytes that are
# each four greater. Keeping the recovered value here makes corpus validation
# reproducible; --key-hex can override it if a future format changes.
ENGINE_DJ_STEMS_AES_KEY = bytes.fromhex("a3d56032f450ecfa4ac73286da06d9e9")


def unpad_pkcs7(payload: bytes, block_size: int = 16) -> bytes:
    if not payload or len(payload) % block_size:
        raise ValueError("payload is not block aligned")
    padding = payload[-1]
    if padding < 1 or padding > block_size:
        raise ValueError(f"invalid PKCS#7 padding length {padding}")
    if payload[-padding:] != bytes([padding]) * padding:
        raise ValueError("invalid PKCS#7 padding bytes")
    return payload[:-padding]


def decrypt_samples(data: bytes, boxes: list[Box], key: bytes) -> list[bytes]:
    cipher = AES.new(key, AES.MODE_ECB)
    decrypted = []
    for index, (offset, size) in enumerate(sample_ranges(data, boxes)):
        ciphertext = data[offset:offset + size]
        try:
            decrypted.append(unpad_pkcs7(cipher.decrypt(ciphertext)))
        except ValueError as error:
            raise ValueError(f"sample {index}: {error}") from error
    return decrypted


def patch_u32(buffer: bytearray, offset: int, value: int) -> None:
    struct.pack_into(">I", buffer, offset, value)


def patch_u64(buffer: bytearray, offset: int, value: int) -> None:
    struct.pack_into(">Q", buffer, offset, value)


def rebuilt_mp4(data: bytes, boxes: list[Box], samples: list[bytes]) -> bytes:
    stsz = find_one(boxes, "stsz")
    stsc = find_one(boxes, "stsc")
    offset_box = find_one(boxes, "co64") if any(box.kind == "co64" for box in boxes) else find_one(boxes, "stco")
    mdat = find_one(boxes, "mdat")
    if len(samples) != len(sample_ranges(data, boxes)):
        raise ValueError("decrypted sample count differs from MP4 sample table")

    patched = bytearray(data)
    patch_u32(patched, stsz.payload_offset + 4, 0)
    patch_u32(patched, stsz.payload_offset + 8, len(samples))
    for index, sample in enumerate(samples):
        patch_u32(patched, stsz.payload_offset + 12 + index * 4, len(sample))

    old_offsets = chunk_offsets(data, offset_box)
    chunk_sample_counts = samples_per_chunks(data, stsc, len(old_offsets))
    new_mdat_payload_offset = mdat.payload_offset
    new_chunk_offsets = []
    cursor = new_mdat_payload_offset
    sample_index = 0
    for count in chunk_sample_counts:
        new_chunk_offsets.append(cursor)
        for _ in range(count):
            cursor += len(samples[sample_index])
            sample_index += 1
    if sample_index != len(samples):
        raise ValueError("chunk map does not cover all decrypted samples")

    width = 8 if offset_box.kind == "co64" else 4
    for index, offset in enumerate(new_chunk_offsets):
        target = offset_box.payload_offset + 8 + index * width
        (patch_u64 if width == 8 else patch_u32)(patched, target, offset)

    media = b"".join(samples)
    if mdat.header_size == 16:
        new_mdat = struct.pack(">I4sQ", 1, b"mdat", len(media) + 16) + media
    else:
        if len(media) + 8 >= 2**32:
            raise ValueError("media data needs a 64-bit mdat header")
        new_mdat = struct.pack(">I4s", len(media) + 8, b"mdat") + media

    top_level = [box for box in boxes if "/" not in box.path]
    output = bytearray()
    for box in top_level:
        if box.kind == "mdat":
            output.extend(new_mdat)
        else:
            output.extend(patched[box.offset:box.end])
    return bytes(output)


def parse_key(value: str) -> bytes:
    try:
        key = bytes.fromhex(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("key must be hexadecimal") from error
    if len(key) not in (16, 24, 32):
        raise argparse.ArgumentTypeError("AES key must contain 16, 24, or 32 bytes")
    return key


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--key-hex", type=parse_key, default=ENGINE_DJ_STEMS_AES_KEY)
    args = parser.parse_args()

    data = args.input.read_bytes()
    boxes = list(walk_boxes(data))
    samples = decrypt_samples(data, boxes, args.key_hex)
    rebuilt = rebuilt_mp4(data, boxes, samples)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(rebuilt)
    print(f"decrypted {len(samples)} access units to {args.output}")


if __name__ == "__main__":
    main()
