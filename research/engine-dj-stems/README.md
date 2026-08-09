# Engine DJ stems interoperability research

This directory is an isolated, read-only research suite for understanding the
`.stems` files exported by Engine DJ. It does not modify the Engine drive and it
does not copy source music into the repository.

The immediate goal is to determine whether an exported four-stem file can be
decoded outside Engine DJ and, if it can, produce four stereo PCM buses in this
order:

1. vocals
2. melody
3. bass
4. drums

## Safety and scope

- The scripts open Engine databases with SQLite's `immutable=1` mode.
- Generated reports and temporary decoder output go under ignored directories.
- No audio is committed or written back to the mounted drive.
- This is an interoperability investigation against files owned by the user.

## Quick start

With the Engine drive mounted as `ELECTRON`:

```sh
cd research/engine-dj-stems
./scripts/run_suite.sh /Volumes/ELECTRON
```

Inspect one container in more detail:

```sh
python3 scripts/inspect_mp4.py \
  '/Volumes/ELECTRON/Engine Library/Stems/400 6f712566-8708-47d2-93ce-7ef5b04b3caf.stems' \
  --samples 12
```

Measure the block-cipher signature across the complete drive:

```sh
python3 scripts/analyze_cipher.py \
  '/Volumes/ELECTRON/Engine Library/Stems' \
  --output reports/generated/cipher.json
```

`decrypt_stems.py` is a strict decoder/remuxer. It validates PKCS#7 on every
access unit before writing anything and includes the Engine DJ 5.0.0 key found
by the local binary analysis (`--key-hex` can override it for another version):

```sh
python3 scripts/decrypt_stems.py input.stems output.m4a
ffmpeg -v error -i output.m4a -f null -
```

Decrypt and split the four stereo buses into 32-bit float WAV files:

```sh
python3 scripts/extract_stems.py input.stems work/extracted
```

The physical channel-pair order is `vocals`, `bass`, `drums`, `melody`.
Consumers should remap that to Engine's documented control order of `vocals`,
`melody`, `bass`, `drums`. Validate every encrypted access unit on a drive:

```sh
python3 scripts/validate_corpus.py \
  '/Volumes/ELECTRON/Engine Library/Stems' \
  --output reports/generated/decryption-validation.json
```

The Python crypto helpers require PyCryptodome (`Crypto.Cipher.AES`).

Run unit tests without an Engine drive:

```sh
python3 -m unittest discover -s tests -v
```

## Outputs

`run_suite.sh` writes machine-readable inventory and decoder logs to
`reports/generated/`. Those files are intentionally ignored. Confirmed findings
and experiment history are kept in [NOTES.md](NOTES.md).
