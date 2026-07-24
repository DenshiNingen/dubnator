// Audio-file codecs shared by the decks, sampler, playlist metadata reader, and
// recorder. Kept independent from the Web Audio graph so container parsing and
// PCM encoding can be tested and maintained without constructing the engine.
(function () {
  // 80-bit IEEE 754 extended precision (big-endian), used for AIFF sample rates.
  function readExtendedFloat80(dv, off) {
    const sign = dv.getUint8(off) & 0x80 ? -1 : 1;
    const exponent = ((dv.getUint8(off) & 0x7f) << 8) | dv.getUint8(off + 1);
    let mantissa = 0;
    for (let i = 0; i < 8; i++) mantissa = mantissa * 256 + dv.getUint8(off + 2 + i);
    if (exponent === 0 && mantissa === 0) return 0;
    return sign * mantissa * Math.pow(2, exponent - 16383 - 63);
  }

  // Fallback for browsers whose decodeAudioData cannot handle AIFF. Supports
  // uncompressed AIFF and common uncompressed AIFC encodings.
  function decodeAiff(ctx, arrayBuffer) {
    const dv = new DataView(arrayBuffer);
    if (arrayBuffer.byteLength < 12) return null;
    const tag = (o) => String.fromCharCode(
      dv.getUint8(o),
      dv.getUint8(o + 1),
      dv.getUint8(o + 2),
      dv.getUint8(o + 3),
    );
    if (tag(0) !== "FORM") return null;
    const form = tag(8);
    if (form !== "AIFF" && form !== "AIFC") return null;

    let comm = null;
    let ssndOffset = -1;
    let p = 12;
    while (p + 8 <= arrayBuffer.byteLength) {
      const id = tag(p);
      const size = dv.getUint32(p + 4);
      const body = p + 8;
      if (id === "COMM") {
        const numChannels = dv.getInt16(body);
        const numSampleFrames = dv.getUint32(body + 2);
        const sampleSize = dv.getInt16(body + 6);
        const sampleRate = readExtendedFloat80(dv, body + 8);
        let compression = "NONE";
        if (form === "AIFC" && size >= 22) compression = tag(body + 18);
        comm = { numChannels, numSampleFrames, sampleSize, sampleRate, compression };
      } else if (id === "SSND") {
        const dataOffset = dv.getUint32(body);
        ssndOffset = body + 8 + dataOffset;
      }
      p = body + size + (size & 1);
    }
    if (!comm || ssndOffset < 0) return null;

    const { numChannels, numSampleFrames, sampleSize, sampleRate, compression } = comm;
    const ch = Math.max(1, numChannels);
    const little = compression === "sowt" || compression === "SOWT";
    const isFloat = compression === "fl32" || compression === "FL32"
      || compression === "fl64" || compression === "FL64";
    const bytesPerSample = sampleSize >> 3;
    if (!isFloat && ![1, 2, 3, 4].includes(bytesPerSample)) return null;

    const buffer = ctx.createBuffer(ch, numSampleFrames, sampleRate || 44100);
    const frameBytes = bytesPerSample * ch;
    for (let c = 0; c < ch; c++) {
      const out = buffer.getChannelData(c);
      for (let i = 0; i < numSampleFrames; i++) {
        const o = ssndOffset + i * frameBytes + c * bytesPerSample;
        if (o + bytesPerSample > arrayBuffer.byteLength) break;
        let sample;
        if (isFloat) {
          sample = bytesPerSample === 8 ? dv.getFloat64(o, little) : dv.getFloat32(o, little);
        } else if (bytesPerSample === 1) {
          sample = dv.getInt8(o) / 128;
        } else if (bytesPerSample === 2) {
          sample = dv.getInt16(o, little) / 32768;
        } else if (bytesPerSample === 3) {
          const b0 = dv.getUint8(o);
          const b1 = dv.getUint8(o + 1);
          const b2 = dv.getUint8(o + 2);
          let value = little ? (b2 << 16) | (b1 << 8) | b0 : (b0 << 16) | (b1 << 8) | b2;
          if (value & 0x800000) value -= 0x1000000;
          sample = value / 8388608;
        } else {
          sample = dv.getInt32(o, little) / 2147483648;
        }
        out[i] = sample;
      }
    }
    return buffer;
  }

  // Header-only duration reading lets playlists display AIFF lengths without
  // decoding the full file.
  function aiffDuration(arrayBuffer) {
    const dv = new DataView(arrayBuffer);
    if (arrayBuffer.byteLength < 12) return null;
    const tag = (o) => String.fromCharCode(
      dv.getUint8(o),
      dv.getUint8(o + 1),
      dv.getUint8(o + 2),
      dv.getUint8(o + 3),
    );
    if (tag(0) !== "FORM") return null;
    const form = tag(8);
    if (form !== "AIFF" && form !== "AIFC") return null;
    let p = 12;
    while (p + 8 <= arrayBuffer.byteLength) {
      const id = tag(p);
      const size = dv.getUint32(p + 4);
      const body = p + 8;
      if (id === "COMM" && body + 16 <= arrayBuffer.byteLength) {
        const numSampleFrames = dv.getUint32(body + 2);
        const sampleRate = readExtendedFloat80(dv, body + 8);
        return sampleRate ? numSampleFrames / sampleRate : null;
      }
      p = body + size + (size & 1);
    }
    return null;
  }

  function floatTo16(sample) {
    const clamped = Math.max(-1, Math.min(1, sample));
    return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
  }

  function encodeWavPCM16(channels, sampleRate) {
    const numCh = channels.length;
    const numFrames = numCh ? channels[0].length : 0;
    const blockAlign = numCh * 2;
    const dataSize = numFrames * blockAlign;
    const buf = new ArrayBuffer(44 + dataSize);
    const dv = new DataView(buf);
    const wstr = (o, s) => {
      for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
    };
    wstr(0, "RIFF");
    dv.setUint32(4, 36 + dataSize, true);
    wstr(8, "WAVE");
    wstr(12, "fmt ");
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, numCh, true);
    dv.setUint32(24, sampleRate, true);
    dv.setUint32(28, sampleRate * blockAlign, true);
    dv.setUint16(32, blockAlign, true);
    dv.setUint16(34, 16, true);
    wstr(36, "data");
    dv.setUint32(40, dataSize, true);
    let o = 44;
    for (let i = 0; i < numFrames; i++) {
      for (let c = 0; c < numCh; c++) {
        dv.setInt16(o, floatTo16(channels[c][i]), true);
        o += 2;
      }
    }
    return buf;
  }

  function writeFloat80(dv, off, value) {
    if (value <= 0) {
      for (let i = 0; i < 10; i++) dv.setUint8(off + i, 0);
      return;
    }
    const exp = Math.floor(Math.log2(value));
    const mant = BigInt(value) << BigInt(63 - exp);
    dv.setUint16(off, (exp + 16383) & 0x7fff);
    dv.setUint32(off + 2, Number(mant >> 32n));
    dv.setUint32(off + 6, Number(mant & 0xffffffffn));
  }

  function encodeAiffPCM16(channels, sampleRate) {
    const numCh = channels.length;
    const numFrames = numCh ? channels[0].length : 0;
    const dataSize = numFrames * numCh * 2;
    const ssndSize = 8 + dataSize;
    const commSize = 18;
    const formSize = 4 + (8 + commSize) + (8 + ssndSize);
    const buf = new ArrayBuffer(8 + formSize);
    const dv = new DataView(buf);
    const wstr = (o, s) => {
      for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
    };
    wstr(0, "FORM");
    dv.setUint32(4, formSize);
    wstr(8, "AIFF");
    let p = 12;
    wstr(p, "COMM");
    dv.setUint32(p + 4, commSize);
    dv.setInt16(p + 8, numCh);
    dv.setUint32(p + 10, numFrames);
    dv.setInt16(p + 14, 16);
    writeFloat80(dv, p + 16, sampleRate);
    p += 8 + commSize;
    wstr(p, "SSND");
    dv.setUint32(p + 4, ssndSize);
    dv.setUint32(p + 8, 0);
    dv.setUint32(p + 12, 0);
    let o = p + 16;
    for (let i = 0; i < numFrames; i++) {
      for (let c = 0; c < numCh; c++) {
        dv.setInt16(o, floatTo16(channels[c][i]), false);
        o += 2;
      }
    }
    return buf;
  }

  window.DubnatorAudioCodecs = {
    decodeAiff,
    aiffDuration,
    encodeWavPCM16,
    encodeAiffPCM16,
  };
})();
