# Investigation notes

Date: 2026-08-09  
Drive: `ELECTRON`  
Engine database schema: `3.0.2`

## Baseline

- The drive contains 365 exported tracks and 194 `.stems` files (about 3.2 GB).
- A stems filename is `<originTrackId> <originDatabaseUuid>.stems`.
- The local exported `Track.id` is **not** the number in the stems filename.
  The correct join uses `Track.originTrackId` and `Track.originDatabaseUuid`.
- Known pair used as the primary fixture:
  - original: `Adala/Hibarnan/Adala - Hibarnan.aiff`
  - stems: `400 6f712566-8708-47d2-93ce-7ef5b04b3caf.stems`

## Container baseline

The known fixture is a valid ISO Base Media File (`isom`) written by
`Lavf58.76.100`. Its single audio track advertises AAC-LC, 44.1 kHz, 8 channels,
about 642 kbit/s and the same duration as the original track. This layout is
consistent with four interleaved stereo stems.

The container itself opens in FFprobe, but the stock AAC decoder rejects or
misdecodes its payload. macOS AudioToolbox does not open it. This distinction is
important: MP4 demuxing works; elementary-stream decoding does not.

## Conclusion

Engine's file is ordinary 8-channel AAC in MP4 after decrypting each compressed
AAC access unit independently with AES-128-ECB and removing PKCS#7 padding. It
does not use ISO Common Encryption metadata. Engine DJ Desktop 5.0.0 contains a
single process-global key, assembled at runtime from 16 immediate bytes.

Recovered key for this format/version:

```text
a3d56032f450ecfa4ac73286da06d9e9
```

See [FORMAT.md](FORMAT.md) for the byte-level algorithm and binary evidence.

## Experiment log

### E01 — stock decoders

- FFprobe recognizes MP4/AAC and reports 8 channels.
- FFmpeg 8.0.1 emits AAC syntax/PCE errors and does not produce useful audio.
- macOS `afinfo` returns `AudioFileOpenURL failed`.
- Symphonia 0.5.5 previously returned `aac: program config element` unsupported.

### E02 — application evidence

The installed Engine DJ application contains the identifiers
`StemsDataAccessor`, `StemAccessSource`, `StemMixer`, and `StemEvents`, and ships
its own FFmpeg 58 libraries. This is local binary evidence, not proof of the
transform used. The next experiment must distinguish a patched AAC decoder from
a pre-decode accessor transform.

### E03 — official renderer

The official standalone `stems-processor` is a renderer backed by zplane
STEMS PRO V1. It is not, based on its exposed CLI and symbols, an exported-stems
playback decoder.

### E04 — complete corpus block analysis

- All 1,849,973 AAC samples in all 194 `.stems` files are divisible by 16.
- The most frequent final 16-byte block is
  `177294975e2f12d7bf8bf6484c692071`, occurring 115,302 times.
- AES-ECB decryption of that block with the recovered key yields sixteen `0x10`
  bytes, the unambiguous full-block PKCS#7 padding case.
- No file contains `sinf`, `schm`, `tenc`, `senc`, `saiz`, `saio`, or `pssh`.

### E05 — Engine DJ 5.0.0 ARM64 path

- `0x101b9bba4`: Engine receives the encoded packet from FFmpeg.
- `0x101b9bbe4`: a stems-output flag gates the private packet transform.
- `0x101b94c5c`: the packet grows to the next 16-byte boundary and is padded.
- `0x101b94ccc`: `av_aes_init` and `av_aes_crypt` perform AES-128-ECB in place.
- `0x101b94db4`: a static initializer builds the 16-byte key by subtracting four
  from every obfuscated immediate byte.
- `0x101b94d64`: the inverse path selects AES decryption and then removes padding.

Addresses are unslid virtual addresses in the ARM64 slice of Engine DJ Desktop
5.0.0.12d16a34d4 and may move in another build.

### E06 — independent decoder validation

- The recovered key passes strict PKCS#7 validation for every one of the
  1,849,973 access units (3,401,039,200 plaintext AAC bytes).
- Four small/median/large fixtures remux and decode without FFmpeg errors.
- Tested decoded durations range from 110.643 s to 552.681 s.
- Hibarnan produces four non-silent stereo pairs at 44.1 kHz for 199.993 s.
- Summing its four pairs correlates 0.9987/0.9984 with the original left/right
  mix; the best scalar fit has 25.39 dB residual SNR. Lossy stem encoding and
  separation artifacts account for the non-null residual.

The physical pair order is Vocals, Bass, Drums, Melody. This is supported both
by Engine's internal four-field order and by spectral measurements (pair 1 is
almost entirely sub-250 Hz in Hibarnan). Engine's official **control** order is
Vocals, Melody, Bass, Drums, so application controls must remap indices to
`0, 3, 1, 2`. `extract_stems.py` names files by physical pair correctly.

## Remaining engineering work

- Integrate the strict decoder into Dubnator's native and browser ingestion path.
- Decode lazily or cache decrypted media so a full USB library is not copied.
- Add four independent Web Audio buses and automated all-muted silence tests.
- Detect future format/key changes and fail explicitly rather than falling back
  to the original stereo track while showing stems as available.
