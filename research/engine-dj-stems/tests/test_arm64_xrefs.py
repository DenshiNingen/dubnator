import importlib.util
import struct
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "arm64_xrefs.py"
SPEC = importlib.util.spec_from_file_location("arm64_xrefs", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class Arm64XrefTests(unittest.TestCase):
    def test_decodes_adrp_and_add_pair(self):
        # adrp x8, pc page + 0x2000; add x0, x8, #0x478
        pc = 0x100000000
        adrp = 0xD0000008
        add = 0x9111E100
        data = struct.pack("<II", adrp, add) + b"\0" * 4
        refs = MODULE.find_references(data, pc + 0x2478, 0, pc, len(data))
        self.assertEqual(len(refs), 1)
        self.assertEqual(refs[0]["register"], 0)


if __name__ == "__main__":
    unittest.main()
