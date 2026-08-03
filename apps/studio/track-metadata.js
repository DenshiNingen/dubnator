/* Embedded artwork/metadata reader for local tracks.
 * Supports ID3v2 (MP3 plus ID3 chunks in WAV/AIFF), FLAC PICTURE blocks and
 * MP4/M4A covr atoms. Results are cached by File so playlist/deck views share
 * one object URL and never upload music or artwork anywhere. */
(function () {
  "use strict";

  const cache = new WeakMap();
  const MAX_TAG_BYTES = 32 * 1024 * 1024;
  const MP4_SCAN_BYTES = 12 * 1024 * 1024;

  const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
  const u32 = (bytes, offset) => (
    ((bytes[offset] << 24) >>> 0)
    + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8)
    + bytes[offset + 3]
  ) >>> 0;
  const u32le = (bytes, offset) => (
    bytes[offset]
    + (bytes[offset + 1] << 8)
    + (bytes[offset + 2] << 16)
    + ((bytes[offset + 3] << 24) >>> 0)
  ) >>> 0;
  const synchsafe = (bytes, offset) => (
    ((bytes[offset] & 0x7f) << 21)
    | ((bytes[offset + 1] & 0x7f) << 14)
    | ((bytes[offset + 2] & 0x7f) << 7)
    | (bytes[offset + 3] & 0x7f)
  );
  const imageMime = (bytes, fallback = "image/jpeg") => {
    if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
    if (ascii(bytes, 0, 4) === "GIF8") return "image/gif";
    if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
    return fallback || "image/jpeg";
  };
  const artwork = (bytes, mime) => {
    if (!bytes?.length) return null;
    const type = imageMime(bytes, mime);
    return {
      artworkUrl: URL.createObjectURL(new Blob([bytes], { type })),
      artworkMime: type,
    };
  };

  function decodeText(bytes, encoding = 3) {
    if (!bytes?.length) return "";
    let charset = "utf-8";
    let source = bytes;
    if (encoding === 0) charset = "iso-8859-1";
    else if (encoding === 1) {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) { charset = "utf-16le"; source = bytes.subarray(2); }
      else if (bytes[0] === 0xfe && bytes[1] === 0xff) { charset = "utf-16be"; source = bytes.subarray(2); }
      else charset = "utf-16";
    } else if (encoding === 2) charset = "utf-16be";
    try {
      return new TextDecoder(charset).decode(source).replace(/\0+$/g, "").trim();
    } catch (_) {
      return new TextDecoder("utf-8").decode(source).replace(/\0+$/g, "").trim();
    }
  }

  function terminated(bytes, start, encoding) {
    const wide = encoding === 1 || encoding === 2;
    if (wide) {
      for (let i = start; i + 1 < bytes.length; i += 2) {
        if (bytes[i] === 0 && bytes[i + 1] === 0) return i + 2;
      }
    } else {
      for (let i = start; i < bytes.length; i += 1) if (bytes[i] === 0) return i + 1;
    }
    return bytes.length;
  }

  function parseId3(bytes, id3Offset = 0) {
    if (ascii(bytes, id3Offset, 3) !== "ID3") return null;
    const version = bytes[id3Offset + 3];
    const tagEnd = Math.min(bytes.length, id3Offset + 10 + synchsafe(bytes, id3Offset + 6));
    const result = {};
    let offset = id3Offset + 10;
    while (offset + (version === 2 ? 6 : 10) <= tagEnd) {
      const idLength = version === 2 ? 3 : 4;
      const id = ascii(bytes, offset, idLength);
      if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
      const size = version === 2
        ? (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5]
        : version === 4 ? synchsafe(bytes, offset + 4) : u32(bytes, offset + 4);
      const dataStart = offset + (version === 2 ? 6 : 10);
      const dataEnd = Math.min(tagEnd, dataStart + size);
      if (size <= 0 || dataStart >= dataEnd) break;
      const frame = bytes.subarray(dataStart, dataEnd);
      const textKey = ({ TIT2: "title", TT2: "title", TPE1: "artist", TP1: "artist", TALB: "album", TAL: "album", TBPM: "bpm", TBP: "bpm" })[id];
      if (textKey && frame.length > 1) result[textKey] = decodeText(frame.subarray(1), frame[0]);
      if ((id === "APIC" || id === "PIC") && !result.artworkUrl && frame.length > 8) {
        const encoding = frame[0];
        let cursor = 1;
        let mime = "image/jpeg";
        if (id === "PIC") {
          const ext = ascii(frame, cursor, 3).toLowerCase();
          mime = ext === "png" ? "image/png" : "image/jpeg";
          cursor += 3;
        } else {
          const mimeEnd = terminated(frame, cursor, 0);
          mime = decodeText(frame.subarray(cursor, Math.max(cursor, mimeEnd - 1)), 0) || mime;
          cursor = mimeEnd;
        }
        cursor += 1; // picture type
        cursor = terminated(frame, cursor, encoding); // description
        Object.assign(result, artwork(frame.subarray(cursor), mime) || {});
      }
      offset = dataEnd;
    }
    return result;
  }

  function findId3(bytes) {
    const limit = Math.max(0, bytes.length - 10);
    for (let i = 0; i <= limit; i += 1) {
      if (
        bytes[i] === 0x49
        && bytes[i + 1] === 0x44
        && bytes[i + 2] === 0x33
        && bytes[i + 3] >= 2
        && bytes[i + 3] <= 4
        && bytes[i + 6] < 128
        && bytes[i + 7] < 128
        && bytes[i + 8] < 128
        && bytes[i + 9] < 128
      ) return i;
    }
    return -1;
  }

  async function readRange(file, start, length, initial) {
    if (start >= 0 && start + length <= initial.length) return initial.subarray(start, start + length);
    return new Uint8Array(await file.slice(start, Math.min(file.size, start + length)).arrayBuffer());
  }

  /* AIFF and WAV commonly place their ID3 chunk after the audio payload. Walking
   * chunk headers lets us jump over that payload instead of reading a whole
   * multi-megabyte track merely to reach its cover art. */
  async function parseChunkedId3(file, initial) {
    const isAiff = ascii(initial, 0, 4) === "FORM"
      && (ascii(initial, 8, 4) === "AIFF" || ascii(initial, 8, 4) === "AIFC");
    const isWave = ascii(initial, 0, 4) === "RIFF" && ascii(initial, 8, 4) === "WAVE";
    if (!isAiff && !isWave) return null;

    let offset = 12;
    for (let chunks = 0; chunks < 512 && offset + 8 <= file.size; chunks += 1) {
      const header = await readRange(file, offset, 8, initial);
      if (header.length < 8) break;
      const id = ascii(header, 0, 4);
      const length = isAiff ? u32(header, 4) : u32le(header, 4);
      const payload = offset + 8;
      if ((id === "ID3 " || id.toLowerCase() === "id3 ") && length >= 10) {
        const bytes = await readRange(file, payload, Math.min(length, MAX_TAG_BYTES), initial);
        const id3Offset = findId3(bytes);
        return id3Offset >= 0 ? (parseId3(bytes, id3Offset) || {}) : {};
      }
      const next = payload + length + (length & 1);
      if (!Number.isSafeInteger(next) || next <= offset || next > file.size + 1) break;
      offset = next;
    }
    return {};
  }

  function parseFlac(bytes) {
    if (ascii(bytes, 0, 4) !== "fLaC") return null;
    let offset = 4;
    while (offset + 4 <= bytes.length) {
      const header = bytes[offset];
      const type = header & 0x7f;
      const length = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
      const start = offset + 4;
      const end = start + length;
      if (end > bytes.length) return null;
      if (type === 6 && length > 32) {
        let p = start + 4;
        const mimeLength = u32(bytes, p); p += 4;
        const mime = decodeText(bytes.subarray(p, p + mimeLength), 0); p += mimeLength;
        const descriptionLength = u32(bytes, p); p += 4 + descriptionLength;
        p += 16; // width, height, colour depth, indexed colours
        const dataLength = u32(bytes, p); p += 4;
        return artwork(bytes.subarray(p, Math.min(end, p + dataLength)), mime);
      }
      offset = end;
      if (header & 0x80) break;
    }
    return null;
  }

  function parseMp4Chunk(bytes) {
    for (let i = 4; i + 20 < bytes.length; i += 1) {
      if (ascii(bytes, i, 4) !== "covr") continue;
      for (let p = i + 4; p + 16 < bytes.length && p < i + 4096; p += 1) {
        if (ascii(bytes, p, 4) !== "data") continue;
        const atomSize = u32(bytes, p - 4);
        const start = p + 12;
        const end = Math.min(bytes.length, p - 4 + atomSize);
        if (atomSize >= 16 && end > start) return artwork(bytes.subarray(start, end));
      }
    }
    return null;
  }

  async function readMetadata(file) {
    if (!file?.slice) return {};
    const initial = new Uint8Array(await file.slice(0, Math.min(file.size, 2 * 1024 * 1024)).arrayBuffer());
    const id3Offset = findId3(initial);
    if (id3Offset >= 0) {
      const declared = 10 + synchsafe(initial, id3Offset + 6);
      const bytes = declared + id3Offset <= initial.length
        ? initial
        : new Uint8Array(await file.slice(0, Math.min(file.size, id3Offset + declared, MAX_TAG_BYTES)).arrayBuffer());
      return parseId3(bytes, id3Offset) || {};
    }
    if (
      (ascii(initial, 0, 4) === "FORM" && (ascii(initial, 8, 4) === "AIFF" || ascii(initial, 8, 4) === "AIFC"))
      || (ascii(initial, 0, 4) === "RIFF" && ascii(initial, 8, 4) === "WAVE")
    ) return (await parseChunkedId3(file, initial)) || {};
    if (ascii(initial, 0, 4) === "fLaC") {
      let offset = 4;
      let required = initial.length;
      while (offset + 4 <= initial.length) {
        const length = (initial[offset + 1] << 16) | (initial[offset + 2] << 8) | initial[offset + 3];
        required = offset + 4 + length;
        if ((initial[offset] & 0x7f) === 6 || (initial[offset] & 0x80)) break;
        offset = required;
      }
      const bytes = required <= initial.length
        ? initial
        : new Uint8Array(await file.slice(0, Math.min(file.size, required, MAX_TAG_BYTES)).arrayBuffer());
      return parseFlac(bytes) || {};
    }
    const head = initial.length >= Math.min(file.size, MP4_SCAN_BYTES)
      ? initial
      : new Uint8Array(await file.slice(0, Math.min(file.size, MP4_SCAN_BYTES)).arrayBuffer());
    let result = parseMp4Chunk(head);
    if (!result && file.size > head.length) {
      const tail = new Uint8Array(await file.slice(Math.max(0, file.size - MP4_SCAN_BYTES)).arrayBuffer());
      result = parseMp4Chunk(tail);
    }
    return result || {};
  }

  function getTrackMetadata(file) {
    if (!file || (typeof file !== "object" && typeof file !== "function")) return Promise.resolve({});
    if (!cache.has(file)) cache.set(file, readMetadata(file).catch(() => ({})));
    return cache.get(file);
  }

  window.DubnatorTrackMetadata = {
    get: getTrackMetadata,
    parseId3,
    parseFlac,
    parseMp4Chunk,
  };
})();
