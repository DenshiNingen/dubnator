#!/usr/bin/env python3
"""Test raw bytes from selected Mach-O sections against a known padding block."""

from __future__ import annotations

import argparse
from pathlib import Path

from Crypto.Cipher import AES


PKCS7_FULL_BLOCK = bytes([16]) * 16


def search(blob: bytes, ciphertext: bytes, step: int, key_sizes: tuple[int, ...]) -> list[tuple[int, bytes]]:
    matches = []
    for offset in range(0, len(blob) - min(key_sizes) + 1, step):
        for size in key_sizes:
            key = blob[offset:offset + size]
            if len(key) == size and AES.new(key, AES.MODE_ECB).decrypt(ciphertext) == PKCS7_FULL_BLOCK:
                matches.append((offset, key))
    return matches


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("binary", type=Path)
    parser.add_argument("--ciphertext", required=True, help="16-byte ciphertext block in hex")
    parser.add_argument("--offset", type=lambda value: int(value, 0), default=0)
    parser.add_argument("--size", type=lambda value: int(value, 0))
    parser.add_argument("--step", type=int, default=4)
    parser.add_argument("--key-sizes", default="16,24,32")
    args = parser.parse_args()

    ciphertext = bytes.fromhex(args.ciphertext)
    if len(ciphertext) != 16:
        parser.error("ciphertext must be exactly 16 bytes")
    sizes = tuple(int(value) for value in args.key_sizes.split(","))
    if any(value not in (16, 24, 32) for value in sizes):
        parser.error("key sizes must be 16, 24, or 32")

    data = args.binary.read_bytes()
    end = len(data) if args.size is None else args.offset + args.size
    blob = data[args.offset:end]
    matches = search(blob, ciphertext, args.step, sizes)
    for relative, key in matches:
        print(f"offset=0x{args.offset + relative:x} bits={len(key) * 8} key={key.hex()}")
    print(f"tested section_bytes={len(blob)} step={args.step} matches={len(matches)}")


if __name__ == "__main__":
    main()
