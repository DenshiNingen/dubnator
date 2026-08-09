#!/usr/bin/env python3
"""Find direct ARM64 ADRP+ADD references in a thin Mach-O image.

This deliberately implements only the addressing pair used for local literals.
It avoids a heavyweight disassembler and is useful on stripped binaries.
"""

from __future__ import annotations

import argparse
import struct
from pathlib import Path


def sign_extend(value: int, bits: int) -> int:
    sign = 1 << (bits - 1)
    return (value & (sign - 1)) - (value & sign)


def adrp_target(instruction: int, pc: int) -> tuple[int, int] | None:
    if instruction & 0x9F000000 != 0x90000000:
        return None
    immlo = (instruction >> 29) & 0x3
    immhi = (instruction >> 5) & 0x7FFFF
    pages = sign_extend((immhi << 2) | immlo, 21)
    return (pc & ~0xFFF) + (pages << 12), instruction & 0x1F


def add_immediate(instruction: int) -> tuple[int, int, int] | None:
    if instruction & 0x7F000000 != 0x11000000:
        return None
    destination = instruction & 0x1F
    source = (instruction >> 5) & 0x1F
    immediate = (instruction >> 10) & 0xFFF
    if instruction & (1 << 22):
        immediate <<= 12
    return destination, source, immediate


def find_references(
    data: bytes,
    target: int,
    text_offset: int,
    text_address: int,
    text_size: int,
) -> list[dict]:
    result = []
    text = data[text_offset:text_offset + text_size]
    for offset in range(0, len(text) - 8, 4):
        first = struct.unpack_from("<I", text, offset)[0]
        adrp = adrp_target(first, text_address + offset)
        if adrp is None:
            continue
        page, register = adrp
        for distance in range(4, 24, 4):
            if offset + distance + 4 > len(text):
                break
            second = struct.unpack_from("<I", text, offset + distance)[0]
            add = add_immediate(second)
            if add and add[1] == register and page + add[2] == target:
                result.append({
                    "adrp": text_address + offset,
                    "add": text_address + offset + distance,
                    "register": add[0],
                })
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("binary", type=Path)
    parser.add_argument("target", type=lambda value: int(value, 0))
    parser.add_argument("--text-offset", type=lambda value: int(value, 0), required=True)
    parser.add_argument("--text-address", type=lambda value: int(value, 0), required=True)
    parser.add_argument("--text-size", type=lambda value: int(value, 0), required=True)
    args = parser.parse_args()
    references = find_references(
        args.binary.read_bytes(), args.target, args.text_offset,
        args.text_address, args.text_size,
    )
    for reference in references:
        print(
            f"adrp={reference['adrp']:#x} add={reference['add']:#x} "
            f"x{reference['register']}"
        )


if __name__ == "__main__":
    main()
