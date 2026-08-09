#!/usr/bin/env python3
"""Build a read-only inventory joining Engine tracks to exported .stems files."""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from pathlib import Path


STEM_NAME = re.compile(r"^(?P<track_id>\d+) (?P<uuid>[0-9a-f-]{36})\.stems$", re.I)


def connect_immutable(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path.as_posix()}?immutable=1", uri=True)


def build_catalog(volume: Path) -> dict:
    library = volume / "Engine Library"
    database = library / "Database2" / "m.db"
    stems_dir = library / "Stems"
    if not database.is_file():
        raise FileNotFoundError(f"Engine database not found: {database}")

    with connect_immutable(database) as connection:
        connection.row_factory = sqlite3.Row
        info = dict(connection.execute("SELECT * FROM Information LIMIT 1").fetchone())
        tracks = connection.execute(
            """
            SELECT id, originTrackId, originDatabaseUuid, title, artist, path,
                   filename, length, fileBytes
            FROM Track
            ORDER BY id
            """
        ).fetchall()

    indexed = {
        (row["originTrackId"], row["originDatabaseUuid"].lower()): row
        for row in tracks
        if row["originTrackId"] and row["originDatabaseUuid"]
    }
    stem_files = []
    unmatched = []
    for path in sorted(stems_dir.glob("*.stems")):
        match = STEM_NAME.match(path.name)
        if not match:
            unmatched.append({"name": path.name, "reason": "unexpected filename"})
            continue
        key = (int(match.group("track_id")), match.group("uuid").lower())
        row = indexed.get(key)
        item = {
            "stem_path": str(path),
            "stem_bytes": path.stat().st_size,
            "origin_track_id": key[0],
            "origin_database_uuid": key[1],
        }
        if row is None:
            unmatched.append({**item, "reason": "no matching Track origin"})
        else:
            original = library / row["path"]
            item.update(
                local_track_id=row["id"],
                title=row["title"],
                artist=row["artist"],
                original_path=str(original),
                original_exists=original.is_file(),
                original_bytes=original.stat().st_size if original.is_file() else None,
                length_seconds=row["length"],
            )
            stem_files.append(item)

    return {
        "volume": str(volume),
        "schema": ".".join(
            str(info[name])
            for name in ("schemaVersionMajor", "schemaVersionMinor", "schemaVersionPatch")
        ),
        "track_count": len(tracks),
        "stem_count": len(stem_files) + len(unmatched),
        "matched_stem_count": len(stem_files),
        "tracks": stem_files,
        "unmatched": unmatched,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("volume", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = build_catalog(args.volume.resolve())
    encoded = json.dumps(result, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    else:
        print(encoded)


if __name__ == "__main__":
    main()

