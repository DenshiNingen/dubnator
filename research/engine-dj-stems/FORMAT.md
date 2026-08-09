# Engine DJ `.stems` format notes

These notes describe the files exported by Engine DJ Desktop 5.0.0 on the
owner's `ELECTRON` drive. They document an interoperability result, not a format
guarantee for future Engine versions.

## Container and channel layout

The file is ISO Base Media File Format (`isom`) with one `mp4a` track:

- AAC-LC
- 44,100 Hz
- 8 channels
- approximately 640 kbit/s
- four consecutive stereo pairs

The physical channel-pair order is:

| Channels | Stem |
| --- | --- |
| 0/1 | Vocals |
| 2/3 | Bass |
| 4/5 | Drums |
| 6/7 | Melody |

Engine documents its **control** order as Pad 1 Vocals, Pad 2 Melody, Pad 3
Bass, Pad 4 Drums. A compatible UI must therefore map control indices to file
pair indices `0, 3, 1, 2`. See the
[official setup guide](https://support.denondj.com/en/support/solutions/articles/69000862383-engine-dj-stems-setup).

## Payload transform

The MP4 sample table describes encrypted access units. For every AAC packet,
Engine performs the equivalent of:

```text
padding = 16 - (plaintext_length mod 16)
padded = plaintext || byte(padding) repeated padding times
ciphertext = AES-128-ECB-ENCRYPT(key, padded)
```

It stores the padded ciphertext length in `stsz`. There is no IV, per-track key,
or standard MP4 encryption box.

The inverse is:

```text
padded = AES-128-ECB-DECRYPT(key, ciphertext)
assert 1 <= padded[-1] <= 16
assert the final padded[-1] bytes all equal padded[-1]
plaintext = padded without those bytes
```

The recovered Engine DJ 5.0.0 key is:

```text
a3 d5 60 32 f4 50 ec fa 4a c7 32 86 da 06 d9 e9
```

The local ARM64 binary initially writes these bytes and subtracts four from
each one before passing the result to FFmpeg's AES API:

```text
a7 d9 64 36 f8 54 f0 fe 4e cb 36 8a de 0a dd ed
```

## Rebuilding a standard file

After decryption, a playable MP4 requires more than replacing bytes in place,
because removing padding changes every sample length. `decrypt_stems.py`:

1. decrypts and strictly unpads every access unit;
2. rewrites every `stsz` entry;
3. rebuilds the contiguous `mdat` payload;
4. recalculates `stco`/`co64` chunk offsets from `stsc`; and
5. preserves the remaining MP4 metadata.

The result opens with stock FFprobe/FFmpeg. `extract_stems.py` then maps channel
pairs `0/1`, `2/3`, `4/5`, and `6/7` to correctly named stereo float WAV files.

## Validation oracle

Three independent checks prevent a false-positive key or malformed remux:

- every packet must have valid PKCS#7 padding;
- stock FFmpeg must decode the rebuilt AAC stream without errors; and
- all four stereo pairs must be non-silent and their sum must closely reproduce
  the original mix.

On the attached corpus, the padding check succeeds for all 194 files and all
1,849,973 access units.
