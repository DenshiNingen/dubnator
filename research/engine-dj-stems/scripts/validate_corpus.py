#!/usr/bin/env python3
"""Validate strict decryption of every access unit in an Engine stems corpus."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from decrypt_stems import ENGINE_DJ_STEMS_AES_KEY, decrypt_samples, parse_key
from inspect_mp4 import walk_boxes


def validate(paths: list[Path], key: bytes) -> dict:
    results = []
    total_samples = 0
    total_plaintext_bytes = 0
    for path in paths:
        data = path.read_bytes()
        samples = decrypt_samples(data, list(walk_boxes(data)), key)
        plaintext_bytes = sum(map(len, samples))
        total_samples += len(samples)
        total_plaintext_bytes += plaintext_bytes
        results.append({
            "path": str(path),
            "samples": len(samples),
            "plaintext_bytes": plaintext_bytes,
            "valid_pkcs7": True,
        })
    return {
        "file_count": len(paths),
        "sample_count": total_samples,
        "plaintext_bytes": total_plaintext_bytes,
        "all_access_units_valid": True,
        "files": results,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    parser.add_argument("--key-hex", type=parse_key, default=ENGINE_DJ_STEMS_AES_KEY)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    paths = sorted(args.path.glob("*.stems")) if args.path.is_dir() else [args.path]
    result = validate(paths, args.key_hex)
    encoded = json.dumps(result, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    else:
        print(encoded)


if __name__ == "__main__":
    main()
