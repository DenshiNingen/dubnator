// Engine DJ drive interoperability.
//
// Reads an exported Engine Library directly in the browser (SQLite via sql.js),
// preserves playlist hierarchy/order, and converts Engine DJ 5.x encrypted
// 8-channel `.stems` MP4 files into ordinary AAC MP4 data for Web Audio.
(function () {
  const STEM_KEY = Uint8Array.from([
    0xa3, 0xd5, 0x60, 0x32, 0xf4, 0x50, 0xec, 0xfa,
    0x4a, 0xc7, 0x32, 0x86, 0xda, 0x06, 0xd9, 0xe9,
  ]);
  const STEM_NAMES = ["VOCALS", "MELODY", "BASS", "DRUMS"];
  // Physical AAC pairs are vocals, bass, drums, melody. Controls follow the
  // official Engine order: vocals, melody, bass, drums.
  const STEM_PAIR_ORDER = [0, 3, 1, 2];
  const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "dinf", "edts", "udta", "ilst", "moof", "traf", "mfra", "mvex"]);

  const u32 = (data, offset) => new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, false);
  const u64 = (data, offset) => Number(new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, false));
  const setU32 = (data, offset, value) => new DataView(data.buffer, data.byteOffset, data.byteLength).setUint32(offset, value, false);
  const setU64 = (data, offset, value) => new DataView(data.buffer, data.byteOffset, data.byteLength).setBigUint64(offset, BigInt(value), false);

  function boxKind(data, offset) {
    return String.fromCharCode(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]);
  }

  function walkBoxes(data, start = 0, end = data.length, parent = "", result = []) {
    let cursor = start;
    while (cursor + 8 <= end) {
      let size = u32(data, cursor);
      const kind = boxKind(data, cursor);
      let headerSize = 8;
      if (size === 1) {
        if (cursor + 16 > end) break;
        size = u64(data, cursor + 8);
        headerSize = 16;
      } else if (size === 0) size = end - cursor;
      if (size < headerSize || cursor + size > end) break;
      const path = parent ? `${parent}/${kind}` : kind;
      const box = { kind, offset: cursor, size, headerSize, payloadOffset: cursor + headerSize, end: cursor + size, path };
      result.push(box);
      if (CONTAINERS.has(kind)) walkBoxes(data, box.payloadOffset, box.end, path, result);
      else if (kind === "meta" && box.payloadOffset + 4 <= box.end) walkBoxes(data, box.payloadOffset + 4, box.end, path, result);
      else if (kind === "stsd") {
        let entryCursor = box.payloadOffset + 8;
        while (entryCursor + 36 <= box.end) {
          const entrySize = u32(data, entryCursor);
          if (entrySize < 36 || entryCursor + entrySize > box.end) break;
          const entryKind = boxKind(data, entryCursor);
          const entryPath = `${path}/${entryKind}`;
          result.push({ kind: entryKind, offset: entryCursor, size: entrySize, headerSize: 8, payloadOffset: entryCursor + 8, end: entryCursor + entrySize, path: entryPath });
          walkBoxes(data, entryCursor + 36, entryCursor + entrySize, entryPath, result);
          entryCursor += entrySize;
        }
      }
      cursor += size;
    }
    return result;
  }

  function findOne(boxes, kind) {
    const found = boxes.filter((box) => box.kind === kind);
    if (found.length !== 1) throw new Error(`Engine stems: expected one ${kind} box, found ${found.length}`);
    return found[0];
  }

  function sampleSizes(data, box) {
    const common = u32(data, box.payloadOffset + 4);
    const count = u32(data, box.payloadOffset + 8);
    if (common) return Array(count).fill(common);
    return Array.from({ length: count }, (_, index) => u32(data, box.payloadOffset + 12 + index * 4));
  }

  function chunkOffsets(data, box) {
    const count = u32(data, box.payloadOffset + 4);
    const width = box.kind === "co64" ? 8 : 4;
    return Array.from({ length: count }, (_, index) => width === 8
      ? u64(data, box.payloadOffset + 8 + index * width)
      : u32(data, box.payloadOffset + 8 + index * width));
  }

  function samplesPerChunks(data, box, chunkCount) {
    const count = u32(data, box.payloadOffset + 4);
    const entries = Array.from({ length: count }, (_, index) => ({
      first: u32(data, box.payloadOffset + 8 + index * 12),
      count: u32(data, box.payloadOffset + 12 + index * 12),
    }));
    if (!entries.length) throw new Error("Engine stems: empty chunk table");
    return Array.from({ length: chunkCount }, (_, index) => {
      const number = index + 1;
      let active = entries[0];
      for (const entry of entries) {
        if (entry.first > number) break;
        active = entry;
      }
      return active.count;
    });
  }

  function sampleRanges(data, boxes) {
    const sizes = sampleSizes(data, findOne(boxes, "stsz"));
    const offsetBoxes = boxes.filter((box) => box.kind === "stco" || box.kind === "co64");
    if (offsetBoxes.length !== 1) throw new Error(`Engine stems: expected one chunk-offset box, found ${offsetBoxes.length}`);
    const offsets = chunkOffsets(data, offsetBoxes[0]);
    const distribution = samplesPerChunks(data, findOne(boxes, "stsc"), offsets.length);
    const ranges = [];
    let sampleIndex = 0;
    offsets.forEach((chunkOffset, chunkIndex) => {
      let cursor = chunkOffset;
      for (let i = 0; i < distribution[chunkIndex]; i++) {
        if (sampleIndex >= sizes.length) throw new Error("Engine stems: chunk table exceeds sample table");
        const size = sizes[sampleIndex++];
        ranges.push({ offset: cursor, size });
        cursor += size;
      }
    });
    if (sampleIndex !== sizes.length) throw new Error(`Engine stems: mapped ${sampleIndex}/${sizes.length} samples`);
    return ranges;
  }

  function decryptStemMp4(input) {
    if (!window.aesjs?.ModeOfOperation?.ecb) throw new Error("AES decoder is not loaded");
    const data = input instanceof Uint8Array ? input : new Uint8Array(input);
    const boxes = walkBoxes(data);
    const ranges = sampleRanges(data, boxes);
    const samples = [];
    const aes = new window.aesjs.ModeOfOperation.ecb(STEM_KEY);
    for (let index = 0; index < ranges.length; index++) {
      const { offset, size } = ranges[index];
      if (!size || size % 16) throw new Error(`Engine stems: sample ${index} is not AES block-aligned`);
      const padded = Uint8Array.from(aes.decrypt(data.subarray(offset, offset + size)));
      const padding = padded[padded.length - 1];
      if (padding < 1 || padding > 16) throw new Error(`Engine stems: invalid padding in sample ${index}`);
      for (let p = padded.length - padding; p < padded.length; p++) {
        if (padded[p] !== padding) throw new Error(`Engine stems: invalid padding bytes in sample ${index}`);
      }
      samples.push(padded.subarray(0, padded.length - padding));
    }

    const patched = data.slice();
    const stsz = findOne(boxes, "stsz");
    const stsc = findOne(boxes, "stsc");
    const offsetBox = boxes.some((box) => box.kind === "co64") ? findOne(boxes, "co64") : findOne(boxes, "stco");
    const mdat = findOne(boxes, "mdat");
    setU32(patched, stsz.payloadOffset + 4, 0);
    setU32(patched, stsz.payloadOffset + 8, samples.length);
    samples.forEach((sample, index) => setU32(patched, stsz.payloadOffset + 12 + index * 4, sample.length));

    const oldChunkOffsets = chunkOffsets(data, offsetBox);
    const chunkCounts = samplesPerChunks(data, stsc, oldChunkOffsets.length);
    let cursor = mdat.payloadOffset;
    let sampleIndex = 0;
    chunkCounts.forEach((count, chunkIndex) => {
      const target = offsetBox.payloadOffset + 8 + chunkIndex * (offsetBox.kind === "co64" ? 8 : 4);
      if (offsetBox.kind === "co64") setU64(patched, target, cursor); else setU32(patched, target, cursor);
      for (let i = 0; i < count; i++) cursor += samples[sampleIndex++].length;
    });
    if (sampleIndex !== samples.length) throw new Error("Engine stems: chunk map does not cover all samples");

    const mediaLength = samples.reduce((total, sample) => total + sample.length, 0);
    const mdatHeader = new Uint8Array(mdat.headerSize);
    if (mdat.headerSize === 16) {
      setU32(mdatHeader, 0, 1);
      mdatHeader.set([0x6d, 0x64, 0x61, 0x74], 4);
      setU64(mdatHeader, 8, mediaLength + 16);
    } else {
      setU32(mdatHeader, 0, mediaLength + 8);
      mdatHeader.set([0x6d, 0x64, 0x61, 0x74], 4);
    }
    const topLevel = boxes.filter((box) => !box.path.includes("/"));
    const outputLength = topLevel.reduce((total, box) => total + (box.kind === "mdat" ? mdatHeader.length + mediaLength : box.size), 0);
    const output = new Uint8Array(outputLength);
    let outputCursor = 0;
    for (const box of topLevel) {
      if (box.kind === "mdat") {
        output.set(mdatHeader, outputCursor);
        outputCursor += mdatHeader.length;
        for (const sample of samples) {
          output.set(sample, outputCursor);
          outputCursor += sample.length;
        }
      } else {
        output.set(patched.subarray(box.offset, box.end), outputCursor);
        outputCursor += box.size;
      }
    }
    return output.buffer;
  }

  let fallbackQueue = Promise.resolve();

  function enqueueFallback(task) {
    const pending = fallbackQueue.then(task, task);
    fallbackQueue = pending.catch(() => {});
    return pending;
  }

  async function decodeStemMp4Fallback(context, input) {
    return enqueueFallback(async () => {
      const FFmpeg = window.FFmpegWASM?.FFmpeg;
      if (!FFmpeg) throw new Error("Engine stems fallback decoder is not loaded");
      const ffmpeg = new FFmpeg();
      const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const inputName = `engine-${token}.m4a`;
      const outputName = `engine-${token}.f32`;
      try {
        await ffmpeg.load({
          coreURL: new URL("vendor/ffmpeg/ffmpeg-core.js", document.baseURI).href,
          wasmURL: new URL("vendor/ffmpeg/ffmpeg-core.wasm", document.baseURI).href,
        });
        await ffmpeg.writeFile(inputName, new Uint8Array(input.slice(0)));
        const result = await ffmpeg.exec([
          "-v", "error", "-i", inputName,
          "-map", "0:a:0", "-c:a", "pcm_f32le",
          "-ar", "44100", "-ac", "8", "-f", "f32le", outputName,
        ]);
        if (result !== 0) throw new Error(`Engine stems fallback exited with code ${result}`);
        const bytes = await ffmpeg.readFile(outputName);
        const raw = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
        const channels = 8;
        const frames = Math.floor(raw.length / channels);
        if (!frames) throw new Error("Engine stems fallback produced no audio");
        const physicalPairs = Array.from({ length: 4 }, () => []);
        for (let pair = 0; pair < 4; pair++) {
          for (let channel = 0; channel < 2; channel++) {
            const output = new Float32Array(frames);
            const sourceChannel = pair * 2 + channel;
            for (let frame = 0, source = sourceChannel; frame < frames; frame++, source += channels) {
              output[frame] = raw[source];
            }
            physicalPairs[pair].push(output);
          }
        }
        return { sampleRate: 44100, length: frames, physicalPairs };
      } finally {
        try { await ffmpeg.deleteFile(inputName); } catch (_) {}
        try { await ffmpeg.deleteFile(outputName); } catch (_) {}
        ffmpeg.terminate();
      }
    });
  }

  function normalizePath(path) {
    return String(path || "").normalize("NFC").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  }

  function engineRelativePath(file) {
    const full = normalizePath(file.webkitRelativePath || file.relativePath || file.name);
    const marker = full.toLowerCase().indexOf("engine library/");
    return marker >= 0 ? full.slice(marker) : full;
  }

  function rows(db, sql) {
    const result = db.exec(sql)[0];
    if (!result) return [];
    return result.values.map((values) => Object.fromEntries(result.columns.map((column, index) => [column, values[index]])));
  }

  function base64UrlFromHex(hex) {
    const bytes = Uint8Array.from(String(hex || "").match(/../g) || [], (pair) => parseInt(pair, 16));
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function attachEngineMetadata(file, metadata) {
    try { Object.defineProperty(file, "engineDJ", { value: metadata, configurable: true }); }
    catch (_) { file.engineDJ = metadata; }
    return file;
  }

  const nextPaint = () => new Promise((resolve) => setTimeout(resolve, 0));
  const assetUrl = (path) => typeof document === "undefined"
    ? path
    : new URL(path, document.baseURI).href;
  const reportProgress = (options, message, progress, detail = "") => {
    try { options?.onProgress?.({ message, progress, detail }); } catch (_) {}
  };

  async function loadSqlAsmFactory() {
    if (loadSqlAsmFactory.factory) return loadSqlAsmFactory.factory;
    if (!loadSqlAsmFactory.promise) {
      loadSqlAsmFactory.promise = new Promise((resolve, reject) => {
        const wasmFactory = window.initSqlJs;
        const script = document.createElement("script");
        script.src = assetUrl("vendor/sql-asm.js");
        script.async = true;
        script.onload = () => {
          const asmFactory = window.initSqlJs;
          window.initSqlJs = wasmFactory;
          if (typeof asmFactory !== "function" || asmFactory === wasmFactory) {
            reject(new Error("SQLite compatibility reader did not initialise"));
            return;
          }
          loadSqlAsmFactory.factory = asmFactory;
          resolve(asmFactory);
        };
        script.onerror = () => reject(new Error("Could not load the SQLite compatibility reader"));
        document.head.appendChild(script);
      });
    }
    return loadSqlAsmFactory.promise;
  }

  async function sqlDatabase(databaseFile, options = {}) {
    if (typeof window.initSqlJs !== "function") throw new Error("SQLite reader is not loaded");
    // WKWebView/Tauri cannot reliably fetch sql-wasm.wasm through its embedded
    // asset protocol. Use sql.js' local asm.js build there; browsers retain the
    // much faster WASM path. Both readers expose the same Database API.
    const compatibility = !!window.__TAURI__ || !!window.__DUBNATOR_FORCE_SQL_ASM;
    const backend = compatibility ? "asm" : "wasm";
    sqlDatabase.promises ||= {};
    if (!sqlDatabase.promises[backend]) {
      if (compatibility) {
        const factory = await loadSqlAsmFactory();
        sqlDatabase.promises[backend] = factory();
      } else {
        sqlDatabase.promises[backend] = window.initSqlJs({
          locateFile: (name) => assetUrl(`vendor/${name}`),
        });
      }
    }
    reportProgress(options, "Opening Engine DJ database", 0.34, compatibility ? "Native compatibility reader" : "WebAssembly database reader");
    await nextPaint();
    const SQL = await sqlDatabase.promises[backend];
    return new SQL.Database(new Uint8Array(await databaseFile.arrayBuffer()));
  }

  async function scanFiles(fileList, options = {}) {
    const files = Array.from(fileList || []);
    reportProgress(options, "Indexing Engine DJ drive", 0.08, `${files.length} files selected`);
    await nextPaint();
    const fileMap = new Map(files.map((file) => [engineRelativePath(file).toLowerCase(), file]));
    const databaseFile = fileMap.get("engine library/database2/m.db")
      || files.find((file) => /(?:^|\/)engine library\/database2\/m\.db$/i.test(normalizePath(file.webkitRelativePath || file.relativePath)));
    if (!databaseFile) throw new Error("No Engine Library/Database2/m.db found. Select the drive root or Engine Library folder.");
    reportProgress(options, "Engine library found", 0.2, databaseFile.name);
    await nextPaint();
    const db = await sqlDatabase(databaseFile, options);
    try {
      reportProgress(options, "Reading tracks and playlists", 0.48, "Database open");
      await nextPaint();
      const tracks = rows(db, `SELECT id, title, artist, album, genre, length,
        COALESCE(NULLIF(bpm, 0), bpmAnalyzed) AS bpm, path, filename,
        albumArtId, originTrackId, originDatabaseUuid FROM Track WHERE isAvailable != 0 OR isAvailable IS NULL`);
      const playlists = rows(db, "SELECT id, title, parentListId, nextListId FROM Playlist");
      const entities = rows(db, "SELECT id, listId, trackId, databaseUuid, nextEntityId FROM PlaylistEntity");
      const playlistPaths = rows(db, "SELECT id, path, position FROM PlaylistPath");
      const artwork = rows(db, "SELECT id, hex(hash) AS hashHex FROM AlbumArt");
      const artworkById = new Map(artwork.map((item) => [Number(item.id), base64UrlFromHex(item.hashHex)]));
      const trackByOrigin = new Map(tracks.map((track) => [`${track.originTrackId}:${track.originDatabaseUuid}`, track]));
      const trackById = new Map(tracks.map((track) => [Number(track.id), track]));
      const pathByPlaylist = new Map(playlistPaths.map((entry) => [Number(entry.id), entry]));
      const playlistById = new Map(playlists.map((playlist) => [Number(playlist.id), playlist]));

      const hierarchy = (playlist) => {
        const exported = pathByPlaylist.get(Number(playlist.id));
        if (exported?.path) {
          // Engine's recursive PlaylistPath view emits leaf -> root
          // (for example "Biga*Ranx;ByArtistsss;").  The browser consumes
          // root -> leaf paths, so normalize the database representation here
          // rather than teaching every UI consumer about Engine's ordering.
          const parts = String(exported.path).split(";").map((part) => part.trim()).filter(Boolean).reverse();
          if (parts.length && parts[parts.length - 1] !== playlist.title) parts.push(playlist.title);
          return parts.length ? parts : [playlist.title];
        }
        const parts = [playlist.title];
        let parent = playlistById.get(Number(playlist.parentListId));
        const visited = new Set([Number(playlist.id)]);
        while (parent && !visited.has(Number(parent.id))) {
          visited.add(Number(parent.id));
          parts.unshift(parent.title);
          parent = playlistById.get(Number(parent.parentListId));
        }
        return parts.filter(Boolean);
      };

      const resolveTrack = (entity) => trackByOrigin.get(`${entity.trackId}:${entity.databaseUuid}`) || trackById.get(Number(entity.trackId));
      const orderedEntities = (playlistId) => {
        const list = entities.filter((entity) => Number(entity.listId) === Number(playlistId));
        const referenced = new Set(list.map((entity) => Number(entity.nextEntityId)).filter(Boolean));
        const byId = new Map(list.map((entity) => [Number(entity.id), entity]));
        const ordered = [];
        const seen = new Set();
        let current = list.find((entity) => !referenced.has(Number(entity.id))) || list[0];
        while (current && !seen.has(Number(current.id))) {
          ordered.push(current); seen.add(Number(current.id));
          current = byId.get(Number(current.nextEntityId));
        }
        list.filter((entity) => !seen.has(Number(entity.id))).sort((a, b) => Number(a.id) - Number(b.id)).forEach((entity) => ordered.push(entity));
        return ordered;
      };

      const catalogue = [];
      for (let playlistIndex = 0; playlistIndex < playlists.length; playlistIndex++) {
        const playlist = playlists[playlistIndex];
        const pathParts = hierarchy(playlist);
        const liveTracks = orderedEntities(playlist.id).map(resolveTrack).filter(Boolean).map((track) => {
          const audioPath = `engine library/${normalizePath(track.path)}`.toLowerCase();
          const audioFile = fileMap.get(audioPath);
          if (!audioFile) return null;
          const stemName = `${track.originTrackId} ${track.originDatabaseUuid}.stems`;
          const stemFile = fileMap.get(`engine library/stems/${stemName}`.toLowerCase()) || null;
          const artHash = artworkById.get(Number(track.albumArtId));
          const artworkFile = artHash ? fileMap.get(`engine library/artwork/${artHash}.jpg`.toLowerCase()) || null : null;
          return attachEngineMetadata(audioFile, {
            source: "engine-dj",
            trackId: Number(track.id),
            originTrackId: Number(track.originTrackId),
            databaseUuid: track.originDatabaseUuid,
            title: track.title || audioFile.name.replace(/\.[^.]+$/, ""),
            artist: track.artist || "",
            album: track.album || "",
            genre: track.genre || "",
            duration: Number(track.length) || 0,
            bpm: Math.round((Number(track.bpm) || 0) * 1000) / 1000,
            hasStems: !!stemFile,
            stemFile,
            artworkFile,
            artworkUrl: artworkFile ? URL.createObjectURL(artworkFile) : null,
          });
        }).filter(Boolean);
        catalogue.push({
          id: `engine:${playlist.id}`,
          name: playlist.title || pathParts[pathParts.length - 1] || "Untitled",
          path: pathParts.join(" / "),
          source: "engine-dj",
          tracks: liveTracks.map((file) => ({
            name: file.name,
            title: file.engineDJ.title,
            artist: file.engineDJ.artist,
            album: file.engineDJ.album,
            genre: file.engineDJ.genre,
            duration: file.engineDJ.duration,
            bpm: file.engineDJ.bpm,
            hasStems: file.engineDJ.hasStems,
          })),
          files: liveTracks,
        });
        reportProgress(
          options,
          "Linking playlists, artwork and stems",
          0.58 + 0.34 * ((playlistIndex + 1) / Math.max(1, playlists.length)),
          `${playlistIndex + 1} / ${playlists.length} playlists`,
        );
        await nextPaint();
      }
      reportProgress(options, "Engine DJ drive ready", 1, `${tracks.length} tracks · ${catalogue.length} playlists`);
      return {
        playlists: catalogue,
        trackCount: tracks.length,
        stemCount: files.filter((file) => /\.stems$/i.test(file.name)).length,
        artworkCount: artwork.length,
        schema: (() => {
          const info = rows(db, "SELECT schemaVersionMajor, schemaVersionMinor, schemaVersionPatch FROM Information LIMIT 1")[0];
          return info ? `${info.schemaVersionMajor}.${info.schemaVersionMinor}.${info.schemaVersionPatch}` : null;
        })(),
      };
    } finally {
      db.close();
    }
  }

  async function filesFromDirectoryHandle(rootHandle, options = {}) {
    const files = [];
    async function visit(handle, prefix) {
      for await (const [name, child] of handle.entries()) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (child.kind === "directory") await visit(child, path);
        else {
          const file = await child.getFile();
          try { Object.defineProperty(file, "relativePath", { value: path }); } catch (_) {}
          files.push(file);
          if (files.length % 40 === 0) {
            reportProgress(options, "Reading drive directory", Math.min(0.18, 0.02 + files.length / 12000), `${files.length} files found`);
            await nextPaint();
          }
        }
      }
    }
    reportProgress(options, "Reading drive directory", 0.02, rootHandle.name || "Selected drive");
    await visit(rootHandle, rootHandle.name === "Engine Library" ? "Engine Library" : "");
    return files;
  }

  async function chooseAndScan(options = {}) {
    if (typeof window.showDirectoryPicker !== "function") throw new Error("Directory picker unavailable");
    const handle = await window.showDirectoryPicker({ mode: "read" });
    return scanFiles(await filesFromDirectoryHandle(handle, options), options);
  }

  window.DubnatorEngineDJ = {
    STEM_NAMES,
    STEM_PAIR_ORDER,
    decryptStemMp4,
    decodeStemMp4Fallback,
    scanFiles,
    chooseAndScan,
    filesFromDirectoryHandle,
    _test: { walkBoxes, sampleRanges, rows, base64UrlFromHex },
  };
})();
