import importlib.util
import struct
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "inspect_mp4.py"
SPEC = importlib.util.spec_from_file_location("inspect_mp4", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def box(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I4s", len(payload) + 8, kind) + payload


class BoxParserTests(unittest.TestCase):
    def test_walks_nested_boxes(self):
        payload = box(b"ftyp", b"isom" + b"\0" * 4) + box(
            b"moov", box(b"trak", box(b"mdia", b""))
        )
        self.assertEqual(
            [entry.path for entry in MODULE.walk_boxes(payload)],
            ["ftyp", "moov", "moov/trak", "moov/trak/mdia"],
        )

    def test_supports_extended_size(self):
        payload = struct.pack(">I4sQ", 1, b"free", 20) + b"test"
        parsed = list(MODULE.walk_boxes(payload))
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0].size, 20)
        self.assertEqual(parsed[0].header_size, 16)

    def test_entropy_bounds(self):
        self.assertEqual(MODULE.entropy(b"\0" * 256), 0.0)
        self.assertAlmostEqual(MODULE.entropy(bytes(range(256))), 8.0)



if __name__ == "__main__":
    unittest.main()
