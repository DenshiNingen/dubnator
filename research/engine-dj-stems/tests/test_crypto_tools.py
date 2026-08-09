import importlib.util
import sys
import unittest
from pathlib import Path

from Crypto.Cipher import AES


SCRIPT = Path(__file__).parents[1] / "scripts" / "decrypt_stems.py"
SPEC = importlib.util.spec_from_file_location("decrypt_stems", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
sys.path.insert(0, str(SCRIPT.parent))
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class CryptoToolTests(unittest.TestCase):
    def test_recovered_key_matches_corpus_padding_oracle(self):
        ciphertext = bytes.fromhex("177294975e2f12d7bf8bf6484c692071")
        plaintext = AES.new(
            MODULE.ENGINE_DJ_STEMS_AES_KEY, AES.MODE_ECB
        ).decrypt(ciphertext)
        self.assertEqual(plaintext, bytes([16]) * 16)

    def test_unpads_pkcs7(self):
        self.assertEqual(MODULE.unpad_pkcs7(b"payload" + bytes([9]) * 9), b"payload")

    def test_rejects_bad_padding(self):
        with self.assertRaisesRegex(ValueError, "padding bytes"):
            MODULE.unpad_pkcs7(b"12345678" + bytes([7]) + bytes([8]) * 7)

    def test_decrypts_one_padded_block(self):
        key = bytes(range(16))
        plaintext = b"AAC packet" + bytes([6]) * 6
        ciphertext = AES.new(key, AES.MODE_ECB).encrypt(plaintext)
        decoded = MODULE.unpad_pkcs7(AES.new(key, AES.MODE_ECB).decrypt(ciphertext))
        self.assertEqual(decoded, b"AAC packet")

    def test_physical_stem_pair_order(self):
        extract_script = SCRIPT.parent / "extract_stems.py"
        spec = importlib.util.spec_from_file_location("extract_stems", extract_script)
        extract_module = importlib.util.module_from_spec(spec)
        assert spec.loader
        sys.modules[spec.name] = extract_module
        spec.loader.exec_module(extract_module)
        self.assertEqual(
            extract_module.STEM_NAMES,
            ("vocals", "bass", "drums", "melody"),
        )


if __name__ == "__main__":
    unittest.main()
