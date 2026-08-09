/* global React, ReactDOM */
const { useEffect, useMemo, useRef, useState } = React;
const eng = window.DubnatorEngine;
const { useFloatingBox } = window.DubnatorFloating;
const trackMetadata = window.DubnatorTrackMetadata;
const rekordbox = window.DubnatorRekordbox;
const engineDJ = window.DubnatorEngineDJ;

const trackKey = (file) => `${file?.name || ""}|${file?.size || 0}|${file?.lastModified || 0}`;
const isAudioFile = (file) => !!file && (
  file.type?.startsWith("audio/")
  || /\.(mp3|wav|aiff?|flac|ogg|m4a|aac|opus)$/i.test(file.name || "")
);

const librarySortValue = (track, key) => {
  if (key === "position") return track.index;
  if (key === "title") return track.info.title || track.info.name || track.file?.name || "";
  if (key === "bpm") return Number(track.info.bpm) || null;
  if (key === "duration") return Number(track.info.duration) || null;
  return track.index;
};

function sortLibraryTracks(tracks, sort) {
  const direction = sort.direction === "desc" ? -1 : 1;
  return [...tracks].sort((left, right) => {
    const a = librarySortValue(left, sort.key);
    const b = librarySortValue(right, sort.key);
    const aMissing = a == null || a === "";
    const bMissing = b == null || b === "";
    // Unknown BPM/duration should never jump to the top when reversing the
    // sort. DJs need the analysed tracks together in both directions.
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    let compared = 0;
    if (typeof a === "string" || typeof b === "string") {
      compared = String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
      if (!compared && sort.key === "title") {
        compared = String(left.info.artist || "").localeCompare(String(right.info.artist || ""), undefined, { sensitivity: "base", numeric: true });
      }
    } else compared = Number(a) - Number(b);
    return compared ? compared * direction : left.index - right.index;
  });
}

// === Saved-playlist storage (localStorage) ===
// We persist only filenames + order. Audio data isn't saved (browser security).
// On load, user re-picks the audio files from disk; we match by name.
const PLAYLISTS_KEY = "dubnator.playlists.v1";
function loadSavedPlaylists() {
  try {
    const raw = localStorage.getItem(PLAYLISTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}
function writeSavedPlaylists(list) {
  try { localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(list)); } catch (_) {}
}
function newPlaylistId() {
  return "pl_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
}
function fmtSavedDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
         d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function mergeLibraryCatalogue(persisted, current) {
  const saved = Array.isArray(persisted) ? persisted : [];
  const live = Array.isArray(current) ? current : [];
  const keyFor = (playlist) => playlist?.id || playlist?.path || playlist?.name;
  const liveByKey = new Map(live.map((playlist) => [keyFor(playlist), playlist]));
  const merged = saved.map((playlist) => {
    const active = liveByKey.get(keyFor(playlist));
    // File objects cannot be persisted, but remain valid for the lifetime of
    // the page. Never replace a connected Engine playlist with its metadata-
    // only IndexedDB snapshot when the manager is reopened.
    return active?.files?.length ? active : playlist;
  });
  const savedKeys = new Set(saved.map(keyFor));
  live.forEach((playlist) => {
    if (!savedKeys.has(keyFor(playlist))) merged.push(playlist);
  });
  return merged;
}

// === PLAYLIST MODAL ===
// Big centered modal showing both decks' playlists. Switch deck via tabs.
// Shows track #, name, duration (lazily decoded). Load and Load & Play are separate actions.
// Per-row: ↑ ↓ (reorder), × (remove). Footer: + Add Files / Shuffle / Clear All.
// Native drag-drop of audio files from OS supported.
function PlaylistModal({
  open,
  deckKey,
  deckA,
  deckB,
  setDeckA,
  setDeckB,
  canReplaceDeckTrack,
  playlistsLinked,
  onTogglePlaylistLink,
  onPlaylistChange,
  onImportProgress,
  onClose,
  onSwitchDeck,
}) {
  const [durations, setDurations] = useState({}); // key: `${deck}|${idx}|${name}` -> seconds
  const [metadata, setMetadata] = useState({});
  const dropRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [plFilter, setPlFilter] = useState(""); // playlist name filter
  const fb = useFloatingBox({ w: 980, h: 620 }, 640, 400); // floating window box

  // Save/load UI state
  const [view, setView] = useState("list"); // "list" | "saved" | "library" | "rekordbox"
  const [saveNameOpen, setSaveNameOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [savedPlaylists, setSavedPlaylists] = useState(() => loadSavedPlaylists());
  const [libraryPlaylists, setLibraryPlaylists] = useState([]);
  const [libraryCollapsed, setLibraryCollapsed] = useState(() => new Set());
  const [selectedLibraryId, setSelectedLibraryId] = useState(null);
  const [libraryTrackFilter, setLibraryTrackFilter] = useState("");
  const [libraryTrackSort, setLibraryTrackSort] = useState({ key: "position", direction: "asc" });
  // Reconcile state for loading: when user picks a saved set, we need files from disk.
  // shape: { id, name, tracks: [...names], pickedFiles: Map<lower(name), File>, missing: [names] }
  const [reconcile, setReconcile] = useState(null);
  const [rekordboxImport, setRekordboxImport] = useState(null);
  const [engineScan, setEngineScan] = useState(null);
  const engineBusy = engineScan?.state === "scanning" || engineScan?.state === "loading";
  const [toast, setToast] = useState(null); // {msg, kind}
  const toastTimer = useRef(null);
  const showToast = (msg, kind = "info") => {
    setToast({ msg, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  };

  useEffect(() => {
    if (!open || !window.DubnatorLibraryStore?.load) return;
    window.DubnatorLibraryStore.load().then((catalogue) => {
      if (catalogue?.playlists) {
        setLibraryPlaylists((current) => mergeLibraryCatalogue(catalogue.playlists, current));
      }
    }).catch(() => {});
  }, [open]);
  const persistLibrary = (playlists) => {
    setLibraryPlaylists(playlists);
    window.DubnatorLibraryStore?.save({ playlists });
  };

  const isA = deckKey === "A";
  const state = isA ? deckA : deckB;
  const setState = isA ? setDeckA : setDeckB;
  const engDeck = isA ? eng.deckA : eng.deckB;
  const label = isA ? "DECK-A" : "DECK-B";
  const accent = isA ? "var(--deck-a, #ff6b3d)" : "var(--deck-b, #3da9ff)";

  // Lazily probe durations for any new playlist files
  useEffect(() => {
    if (!open || !engDeck) return;
    const files = engDeck.playlist || [];
    let cancelled = false;
    let cursor = 0;
    const probe = async (file, i) => {
      const key = `${deckKey}|${i}|${file.name}|${file.size}`;
      if (file.engineDJ?.duration && durations[key] == null) {
        setDurations((current) => ({ ...current, [key]: file.engineDJ.duration }));
      } else if (durations[key] == null) await new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const el = document.createElement("audio");
        el.preload = "metadata";
        el.src = url;
        const cleanup = () => { try { URL.revokeObjectURL(url); } catch (_) {} };
        const done = (value) => {
          if (!cancelled && value) setDurations((d) => ({ ...d, [key]: value }));
          cleanup(); resolve();
        };
        el.addEventListener("loadedmetadata", () => done(el.duration || 0));
        el.addEventListener("error", () => {
          if (!window.DubnatorAiffDuration) { done(0); return; }
          file.slice(0, 1 << 18).arrayBuffer().then((head) => done(window.DubnatorAiffDuration(head) || 0)).catch(() => done(0));
        });
      });
      const metaKey = trackKey(file);
      if (!cancelled && metadata[metaKey] == null && trackMetadata?.get) {
        try {
          const info = await trackMetadata.get(file);
          if (!cancelled) setMetadata((current) => current[metaKey] != null ? current : { ...current, [metaKey]: info || {} });
        } catch (_) {}
      }
    };
    // Four probes keep a 400-track library responsive instead of creating
    // hundreds of audio elements and full-file metadata reads at once.
    const workers = Array.from({ length: 4 }, async () => {
      while (!cancelled) {
        const i = cursor++;
        if (i >= files.length) return;
        await probe(files[i], i);
      }
    });
    Promise.all(workers).catch(() => {});
    return () => { cancelled = true; };
  }, [open, deckKey, state.playlist.length, state.playlist.join("|")]);

  const fmtDur = (s) => {
    if (!s || !isFinite(s)) return "—:—";
    const m = Math.floor(s / 60), ss = Math.floor(s % 60);
    return `${m}:${String(ss).padStart(2, "0")}`;
  };

  const totalDur = useMemo(() => {
    const files = (engDeck && engDeck.playlist) || [];
    return files.reduce((acc, file, i) => {
      const key = `${deckKey}|${i}|${file.name}|${file.size}`;
      return acc + (durations[key] || 0);
    }, 0);
  }, [durations, state.playlist.length, deckKey, state.playlist.join("|")]);

  const libraryRows = useMemo(() => {
    const root = { path: "", name: "LIBRARY", children: new Map(), playlist: null };
    libraryPlaylists.forEach((playlist) => {
      const parts = String(playlist.path || playlist.name || "Untitled")
        .split(" / ").map((part) => part.trim()).filter(Boolean).filter((part) => part !== "ROOT");
      let node = root;
      parts.forEach((part) => {
        const path = node.path ? `${node.path} / ${part}` : part;
        if (!node.children.has(part)) node.children.set(part, { path, name: part, children: new Map(), playlist: null });
        node = node.children.get(part);
      });
      node.playlist = playlist;
    });
    const rows = [];
    const walk = (node, depth) => {
      Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })).forEach((child) => {
        const hasChildren = child.children.size > 0;
        rows.push({ kind: hasChildren ? "folder" : "playlist", node: child, depth });
        if (!libraryCollapsed.has(child.path)) walk(child, depth + 1);
        // Engine folders may also be aggregate playlists containing the union
        // of their children. The folder row itself selects that aggregate, so
        // never duplicate it as a second playlist row below the children.
      });
    };
    walk(root, 0);
    return rows;
  }, [libraryPlaylists, libraryCollapsed]);

  const selectedLibraryPlaylist = useMemo(() => libraryPlaylists.find((playlist) => (
    (playlist.id || playlist.path) === selectedLibraryId
  )) || null, [libraryPlaylists, selectedLibraryId]);

  useEffect(() => {
    if (!libraryPlaylists.length) {
      if (selectedLibraryId != null) setSelectedLibraryId(null);
      return;
    }
    if (libraryPlaylists.some((playlist) => (playlist.id || playlist.path) === selectedLibraryId)) return;
    const preferred = libraryPlaylists.find((playlist) => playlist.source === "engine-dj" && playlist.files?.length)
      || libraryPlaylists.find((playlist) => playlist.source === "engine-dj")
      || libraryPlaylists[0];
    setSelectedLibraryId(preferred.id || preferred.path);
  }, [libraryPlaylists, selectedLibraryId]);

  useEffect(() => { setLibraryTrackFilter(""); }, [selectedLibraryId]);

  const changeLibraryTrackSort = (key) => {
    setLibraryTrackSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: "asc" });
  };

  const librarySortLabel = (key, label) => {
    const active = libraryTrackSort.key === key;
    return (
      <button type="button" className={`engine-track-sort ${active ? "active" : ""}`}
        aria-label={`Sort by ${label}${active ? `, currently ${libraryTrackSort.direction === "asc" ? "ascending" : "descending"}` : ""}`}
        onClick={() => changeLibraryTrackSort(key)}>
        <span>{label}</span>
        <i aria-hidden="true">{active ? (libraryTrackSort.direction === "asc" ? "▲" : "▼") : "◇"}</i>
      </button>
    );
  };

  const onLoad = async (i, play = true) => {
    if (!engDeck) return;
    if (canReplaceDeckTrack && !canReplaceDeckTrack(deckKey)) return;
    try {
      await engDeck.loadPlaylistIndex(i);
      if (play) engDeck.play();
      setState(s => ({ ...s, loopOn: false, loopIn: 0, playlistIdx: i, name: engDeck.name, playing: play && engDeck.playing }));
    } catch (err) {
      console.error("Track load failed", err);
      const f = engDeck.playlist[i];
      setState(s => ({ ...s, playlistIdx: i, name: "⚠ CAN'T DECODE — " + (f ? f.name : ""), playing: false }));
    }
  };
  const onMove = (from, to) => {
    if (!engDeck) return;
    if (to < 0 || to >= engDeck.playlist.length) return;
    engDeck.movePlaylistItem(from, to);
    onPlaylistChange?.(deckKey);
    setState(s => ({
      ...s,
      playlist: engDeck.playlist.map(f => f.name),
      playlistIdx: engDeck.playlistIdx,
    }));
  };
  const onRemove = (i) => {
    if (!engDeck) return;
    const wasPlaying = i === engDeck.playlistIdx;
    engDeck.removeAt(i);
    onPlaylistChange?.(deckKey);
    setState(s => ({
      ...s,
      playlist: engDeck.playlist.map(f => f.name),
      playlistIdx: engDeck.playlistIdx,
      name: wasPlaying ? (engDeck.playlist[engDeck.playlistIdx]?.name || "—") : s.name,
    }));
  };
  const onClear = () => {
    if (!engDeck) return;
    if (engDeck.playlist.length === 0) return;
    engDeck.stop && engDeck.stop();
    engDeck.clearPlaylist();
    onPlaylistChange?.(deckKey);
    setState(s => ({ ...s, playlist: [], playlistIdx: 0, name: "—", playing: false }));
  };
  const onShuffle = () => {
    if (!engDeck) return;
    engDeck.shufflePlaylist();
    onPlaylistChange?.(deckKey);
    setState(s => ({
      ...s,
      playlist: engDeck.playlist.map(f => f.name),
      playlistIdx: engDeck.playlistIdx,
    }));
  };

  // === SAVE / LOAD ===
  const refreshSaved = () => setSavedPlaylists(loadSavedPlaylists());

  const defaultSaveName = () => {
    const stamp = new Date();
    const dd = stamp.toLocaleDateString([], { month: "short", day: "numeric" });
    const tt = stamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `${label} · ${dd} ${tt}`;
  };
  const openSavePrompt = () => {
    if (!engDeck || engDeck.playlist.length === 0) return;
    setSaveName(defaultSaveName());
    setSaveNameOpen(true);
  };
  const confirmSave = () => {
    if (!engDeck || engDeck.playlist.length === 0) return;
    const trimmed = (saveName || "").trim() || defaultSaveName();
    const entry = {
      id: newPlaylistId(),
      name: trimmed,
      deck: deckKey,
      tracks: engDeck.playlist.map(f => f.name),
      created: Date.now(),
    };
    const list = [entry, ...loadSavedPlaylists()];
    writeSavedPlaylists(list);
    setSavedPlaylists(list);
    setSaveNameOpen(false);
    setSaveName("");
    showToast(`Saved "${trimmed}"`, "ok");
  };
  const cancelSave = () => { setSaveNameOpen(false); setSaveName(""); };

  const openLoadView = () => {
    refreshSaved();
    setView("saved");
    setReconcile(null);
  };
  const openLibraryView = () => {
    setView("library");
    setReconcile(null);
  };
  const closeLoadView = () => {
    setView("list");
    setReconcile(null);
  };

  const beginReconcile = (entry) => {
    // Reuse the existing file-reconciliation surface for both saved and
    // imported library playlists.
    setView("saved");
    setReconcile({
      id: entry.id,
      name: entry.name,
      tracks: entry.tracks.slice(),
      pickedFiles: {}, // lowercased name -> File
      sourceDeck: entry.deck,
    });
  };
  const onReconcileFiles = (filesIn) => {
    const files = Array.from(filesIn || []).filter(isAudioFile);
    if (!files.length) return;
    setReconcile(r => {
      if (!r) return r;
      const picked = { ...r.pickedFiles };
      files.forEach(f => { picked[f.name.toLowerCase()] = f; });
      return { ...r, pickedFiles: picked };
    });
  };
  const applyReconcile = async (skipMissing) => {
    if (!reconcile || !engDeck) return;
    if (canReplaceDeckTrack && !canReplaceDeckTrack(deckKey)) return;
    const ordered = [];
    const missing = [];
    reconcile.tracks.forEach(name => {
      const f = reconcile.pickedFiles[name.toLowerCase()];
      if (f) ordered.push(f);
      else missing.push(name);
    });
    if (!ordered.length) {
      showToast("No matched audio files yet — pick the source files first.", "warn");
      return;
    }
    if (missing.length && !skipMissing) {
      // confirm via toast — caller will pass skipMissing=true on second click
      showToast(`${missing.length} track${missing.length === 1 ? "" : "s"} not found — click LOAD AS-IS to skip`, "warn");
      return;
    }
    // Replace deck playlist
    if (engDeck.stop) engDeck.stop();
    engDeck.clearPlaylist();
    ordered.forEach(f => engDeck.addToPlaylist(f));
    onPlaylistChange?.(deckKey);
    await engDeck.loadPlaylistIndex(0);
    setState(s => ({
      ...s,
      playlist: engDeck.playlist.map(f => f.name),
      playlistIdx: 0,
      name: engDeck.name,
      playing: false,
    }));
    setReconcile(null);
    setView("list");
    showToast(`Loaded ${ordered.length} track${ordered.length === 1 ? "" : "s"}${missing.length ? ` · ${missing.length} skipped` : ""}`, "ok");
  };

  const deleteSaved = (id) => {
    const list = loadSavedPlaylists().filter(p => p.id !== id);
    writeSavedPlaylists(list);
    setSavedPlaylists(list);
    if (reconcile && reconcile.id === id) setReconcile(null);
  };
  const renameSaved = (id, newName) => {
    const list = loadSavedPlaylists().map(p => p.id === id ? { ...p, name: newName } : p);
    writeSavedPlaylists(list);
    setSavedPlaylists(list);
  };

  const exportJson = () => {
    if (!engDeck || engDeck.playlist.length === 0) return;
    const payload = {
      kind: "dubnator.playlist",
      version: 1,
      name: defaultSaveName(),
      deck: deckKey,
      tracks: engDeck.playlist.map(f => f.name),
      created: Date.now(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(payload.name || "playlist").replace(/[^a-z0-9-_]+/gi, "_")}.dubnator.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Exported playlist JSON", "ok");
  };

  // Bundle audio files + manifest into a self-contained .zip.
  // Layout:
  //   manifest.json
  //   audio/01 - <safe original name>
  const exportZip = async () => {
    if (!engDeck || engDeck.playlist.length === 0) return;
    if (typeof window.JSZip === "undefined") {
      showToast("ZIP library not loaded", "warn");
      return;
    }
    showToast("Building ZIP…", "info");
    try {
      const zip = new window.JSZip();
      const audio = zip.folder("audio");
      const safeName = (s) => s.replace(/[\\/:*?"<>|]/g, "_");
      const tracks = [];
      const usedNames = new Set();
      engDeck.playlist.forEach((file, i) => {
        let entryName = `${String(i + 1).padStart(2, "0")} - ${safeName(file.name)}`;
        // disambiguate just in case
        let n = 1;
        while (usedNames.has(entryName)) {
          entryName = `${String(i + 1).padStart(2, "0")}_${n} - ${safeName(file.name)}`;
          n++;
        }
        usedNames.add(entryName);
        audio.file(entryName, file);
        tracks.push(entryName);
      });
      const baseName = defaultSaveName();
      const manifest = {
        kind: "dubnator.playlist.bundle",
        version: 1,
        name: baseName,
        deck: deckKey,
        tracks,                                  // names of files inside audio/, in order
        originalNames: engDeck.playlist.map(f => f.name), // for reference
        created: Date.now(),
      };
      zip.file("manifest.json", JSON.stringify(manifest, null, 2));
      const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseName.replace(/[^a-z0-9-_]+/gi, "_")}.dubnator.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast(`Exported ZIP · ${(blob.size / 1024 / 1024).toFixed(1)} MB`, "ok");
    } catch (err) {
      console.error(err);
      showToast("ZIP export failed", "warn");
    }
  };

  // Detects file extension and routes to ZIP or JSON.
  const importBundle = async (file) => {
    if (!file) return;
    const isZip = /\.zip$/i.test(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed";
    if (isZip) await importZip(file);
    else await importJson(file);
  };

  const importZip = async (file) => {
    if (canReplaceDeckTrack && !canReplaceDeckTrack(deckKey)) return;
    if (typeof window.JSZip === "undefined") {
      showToast("ZIP library not loaded", "warn");
      return;
    }
    showToast("Reading ZIP…", "info");
    try {
      const zip = await window.JSZip.loadAsync(file);
      const manifestEntry = zip.file("manifest.json");
      if (!manifestEntry) throw new Error("no manifest");
      const manifestTxt = await manifestEntry.async("string");
      const manifest = JSON.parse(manifestTxt);
      const tracks = Array.isArray(manifest?.tracks) ? manifest.tracks : null;
      if (!tracks || !tracks.length) throw new Error("no tracks");

      // Extract each audio file as a File object
      const audioFiles = [];
      for (let i = 0; i < tracks.length; i++) {
        const trackPath = tracks[i].startsWith("audio/") ? tracks[i] : `audio/${tracks[i]}`;
        const entry = zip.file(trackPath);
        if (!entry) {
          console.warn("missing in zip:", trackPath);
          continue;
        }
        const blob = await entry.async("blob");
        const origName = (manifest.originalNames && manifest.originalNames[i]) || tracks[i];
        // Guess MIME from extension so audio elements pick it up
        const ext = (origName.match(/\.([a-z0-9]+)$/i) || [, ""])[1].toLowerCase();
        const mimeMap = { mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", opus: "audio/ogg" };
        const type = mimeMap[ext] || "audio/mpeg";
        audioFiles.push(new File([blob], origName, { type }));
      }

      if (!audioFiles.length) throw new Error("no audio");

      // Replace deck playlist directly — no reconcile needed
      if (engDeck.stop) engDeck.stop();
      engDeck.clearPlaylist();
      audioFiles.forEach(f => engDeck.addToPlaylist(f));
      onPlaylistChange?.(deckKey);
      await engDeck.loadPlaylistIndex(0);
      setState(s => ({
        ...s,
        playlist: engDeck.playlist.map(f => f.name),
        playlistIdx: 0,
        name: engDeck.name,
        playing: false,
      }));

      // Also save the manifest reference into the saved-playlists list
      const entry = {
        id: newPlaylistId(),
        name: manifest.name || file.name.replace(/\.zip$/i, ""),
        deck: manifest.deck || deckKey,
        tracks: (manifest.originalNames || tracks),
        created: Date.now(),
      };
      const list = [entry, ...loadSavedPlaylists()];
      writeSavedPlaylists(list);
      setSavedPlaylists(list);

      setView("list");
      setReconcile(null);
      const skipped = tracks.length - audioFiles.length;
      showToast(`Loaded ${audioFiles.length} track${audioFiles.length === 1 ? "" : "s"} from ZIP${skipped ? ` · ${skipped} missing` : ""}`, "ok");
    } catch (err) {
      console.error(err);
      showToast("ZIP import failed — invalid bundle", "warn");
    }
  };

  const importJson = async (file) => {
    if (!file) return;
    try {
      const txt = await file.text();
      const data = JSON.parse(txt);
      const tracks = Array.isArray(data?.tracks) ? data.tracks : null;
      if (!tracks || !tracks.length) throw new Error("no tracks");
      const entry = {
        id: newPlaylistId(),
        name: data.name || file.name.replace(/\.json$/i, "") || "Imported playlist",
        deck: data.deck || deckKey,
        tracks,
        created: Date.now(),
      };
      const list = [entry, ...loadSavedPlaylists()];
      writeSavedPlaylists(list);
      setSavedPlaylists(list);
      setView("saved");
      showToast(`Imported "${entry.name}"`, "ok");
    } catch (err) {
      showToast("Could not import — invalid file", "warn");
    }
  };
  const onImportInput = (e) => { importBundle(e.target.files?.[0]); e.target.value = ""; };

  const importRekordboxXmls = async (filesInput) => {
    const files = Array.from(filesInput || []).filter((file) => file.name?.toLowerCase().endsWith(".xml"));
    if (!files.length || !rekordbox?.parse) return;
    try {
      const parsedSources = await Promise.all(files.map(async (file) => ({ name: file.name, parsed: rekordbox.parse(await file.text()) })));
      const combined = rekordbox.combine
        ? rekordbox.combine(parsedSources.map((source) => source.parsed))
        : parsedSources[0].parsed;
      if (!combined.playlists.length) throw new Error("No playlists found");
      const imported = combined.playlists.map((playlist, index) => ({
        id: `rb_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 6)}`,
        name: playlist.name,
        path: playlist.path,
        source: "rekordbox",
        sources: files.map((file) => file.name),
        tracks: playlist.tracks.map((track) => track.fileName || track.name),
        trackRefs: playlist.tracks,
        created: Date.now(),
      }));
      const existing = new Map(libraryPlaylists.map((playlist) => [playlist.path, playlist]));
      imported.forEach((playlist) => existing.set(playlist.path, playlist));
      persistLibrary(Array.from(existing.values()));
      setRekordboxImport({ sourceName: files.map((file) => file.name).join(", "), playlists: combined.playlists, selectedPath: combined.playlists[0].path });
      setReconcile(null);
      setView("rekordbox");
      showToast(`Imported ${imported.length} playlist${imported.length === 1 ? "" : "s"} from ${files.length} XML${files.length === 1 ? "" : "s"}`, "ok");
    } catch (error) {
      console.error("Rekordbox import failed", error);
      showToast(error?.message || "Could not read Rekordbox XML", "warn");
    }
  };
  const onRekordboxInput = (event) => {
    importRekordboxXmls(event.target.files);
    event.target.value = "";
  };

  const importEngineDrive = async (filesInput) => {
    if (!engineDJ?.scanFiles) return;
    setEngineScan({ state: "scanning", message: "Opening Engine DJ drive", detail: "Preparing file index", progress: 0.02 });
    try {
      const result = await engineDJ.scanFiles(filesInput, {
        onProgress: ({ message, detail, progress }) => setEngineScan({
          state: "scanning",
          message,
          detail,
          progress: Math.max(0, Math.min(1, Number(progress) || 0)),
        }),
      });
      const merged = [
        ...libraryPlaylists.filter((playlist) => playlist.source !== "engine-dj"),
        ...result.playlists,
      ];
      setLibraryPlaylists(merged);
      // File objects stay live only for this selected drive. Persist the tree
      // and metadata, never multi-megabyte audio/stem contents.
      window.DubnatorLibraryStore?.save({
        playlists: merged.map(({ files, ...playlist }) => playlist),
      });
      setEngineScan({
        state: "ready",
        message: `${result.trackCount} tracks · ${result.playlists.length} playlists · ${result.stemCount} stems`,
        detail: "Engine DJ library connected",
        progress: 1,
      });
      const firstEnginePlaylist = result.playlists.find((playlist) => playlist.files?.length)
        || result.playlists[0];
      setSelectedLibraryId(firstEnginePlaylist ? (firstEnginePlaylist.id || firstEnginePlaylist.path) : null);
      setView("library");
      showToast(`Engine DJ ready · ${result.playlists.length} playlists · ${result.stemCount} stems`, "ok");
    } catch (error) {
      console.error("Engine DJ scan failed", error);
      setEngineScan({ state: "error", message: error?.message || "Could not read Engine DJ drive", detail: "Select the drive root or Engine Library folder", progress: 0 });
      showToast(error?.message || "Could not read Engine DJ drive", "warn");
    }
  };
  const onEngineDriveInput = (event) => {
    importEngineDrive(event.target.files);
    event.target.value = "";
  };

  const loadEnginePlaylist = async (playlist, options = {}) => {
    if (!playlist?.files?.length || !engDeck) {
      showToast("Reconnect the Engine DJ drive to load this playlist", "warn");
      return;
    }
    if (canReplaceDeckTrack && !canReplaceDeckTrack(deckKey)) return;
    const targetIndex = Math.max(0, Math.min(playlist.files.length - 1, Number(options.index) || 0));
    const shouldPlay = !!options.play;
    setEngineScan({ state: "loading", message: `Loading ${playlist.name}`, detail: `Preparing ${playlist.files.length} tracks`, progress: 0.18 });
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      engDeck.stop?.();
      engDeck.clearPlaylist();
      playlist.files.forEach((file) => engDeck.addToPlaylist(file));
      const targetFile = playlist.files[targetIndex];
      setEngineScan({ state: "loading", message: `Loading ${playlist.name}`, detail: targetFile?.engineDJ?.hasStems ? "Decoding selected track and stems" : "Decoding selected track", progress: 0.58 });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await engDeck.loadPlaylistIndex(targetIndex);
      if (shouldPlay) engDeck.play();
      setState((current) => ({
        ...current,
        playlist: engDeck.playlist.map((file) => file.name),
        playlistIdx: targetIndex,
        name: engDeck.name,
        playing: shouldPlay && engDeck.playing,
        stems: engDeck.getStemState?.(),
      }));
      onPlaylistChange?.(deckKey);
      setEngineScan({ state: "ready", message: `${playlist.files.length} tracks loaded`, detail: `${playlist.name} · Deck ${deckKey} ${shouldPlay ? "playing" : "paused"}`, progress: 1 });
      if (!options.stayInLibrary) setView("list");
      showToast(`${targetFile?.engineDJ?.title || targetFile?.name || "Track"} · Deck ${deckKey} ${shouldPlay ? "playing" : "paused"}`, "ok");
    } catch (error) {
      console.error("Engine DJ playlist load failed", error);
      setEngineScan({ state: "error", message: error?.message || "Could not load Engine DJ playlist", detail: playlist.name, progress: 0 });
      showToast(error?.message || "Could not load Engine DJ playlist", "warn");
    }
  };

  const selectedRekordbox = rekordboxImport?.playlists?.find((playlist) => (
    playlist.path === rekordboxImport.selectedPath
  )) || null;
  const rekordboxLoadedMatch = selectedRekordbox && rekordbox?.matchPlaylistFiles
    ? rekordbox.matchPlaylistFiles(selectedRekordbox, engDeck?.playlist || [])
    : { ordered: [], missing: [], unused: [] };

  const applyRekordboxOrder = async (filesInput) => {
    if (!selectedRekordbox || !engDeck || !rekordbox?.matchPlaylistFiles) return;
    const pool = Array.from(filesInput || engDeck.playlist || []).filter(isAudioFile);
    const result = rekordbox.matchPlaylistFiles(selectedRekordbox, pool);
    if (!result.ordered.length) {
      showToast("No local audio matched this Rekordbox playlist", "warn");
      return;
    }
    const currentFile = engDeck.file || engDeck.playlist[engDeck.playlistIdx];
    const currentIndex = currentFile
      ? result.ordered.findIndex((file) => file === currentFile || (
        file.name === currentFile.name
        && file.size === currentFile.size
        && file.lastModified === currentFile.lastModified
      ))
      : -1;
    const needsNewTrack = currentIndex < 0 || !engDeck.buffer;
    if (needsNewTrack && canReplaceDeckTrack && !canReplaceDeckTrack(deckKey)) return;
    engDeck.playlist = [...result.ordered];
    engDeck.playlistIdx = currentIndex >= 0 ? currentIndex : 0;
    if (needsNewTrack) {
      engDeck.stop?.();
      await engDeck.loadPlaylistIndex(engDeck.playlistIdx);
    }
    setState((current) => ({
      ...current,
      playlist: engDeck.playlist.map((file) => file.name),
      playlistIdx: engDeck.playlistIdx,
      name: engDeck.name,
      playing: needsNewTrack ? false : current.playing,
    }));
    onPlaylistChange?.(deckKey);
    setView("list");
    const skipped = result.missing.length;
    showToast(
      `Applied Rekordbox order · ${result.ordered.length} matched${skipped ? ` · ${skipped} missing` : ""}`,
      skipped ? "info" : "ok",
    );
  };

  const onAdd = async (filesIn) => {
    const files = Array.from(filesIn || []).filter(isAudioFile);
    if (!files.length || !engDeck) return;
    const wasEmpty = engDeck.playlist.length === 0;
    if (wasEmpty && canReplaceDeckTrack && !canReplaceDeckTrack(deckKey)) return;
    onImportProgress?.({ deckKey, done: 0, total: files.length });
    for (let i = 0; i < files.length; i += 32) {
      files.slice(i, i + 32).forEach((file) => engDeck.addToPlaylist(file));
      onImportProgress?.({ deckKey, done: Math.min(i + 32, files.length), total: files.length });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    onPlaylistChange?.(deckKey);
    if (wasEmpty) {
      await engDeck.loadPlaylistIndex(0);
      setState(s => ({
        ...s,
        playlist: engDeck.playlist.map(f => f.name),
        playlistIdx: 0,
        name: engDeck.name,
      }));
    } else {
      setState(s => ({
        ...s,
        playlist: engDeck.playlist.map(f => f.name),
      }));
    }
    onImportProgress?.(null);
  };
  const onFileInput = (e) => { onAdd(e.target.files); e.target.value = ""; };
  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = (e) => {
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
  };
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (view === "saved" && reconcile) { onReconcileFiles(e.dataTransfer.files); return; }
    if (view === "rekordbox" && selectedRekordbox) { applyRekordboxOrder(e.dataTransfer.files); return; }
    onAdd(e.dataTransfer.files);
  };

  if (!open) return null;
  const files = (engDeck && engDeck.playlist) || [];
  const curIdx = engDeck ? engDeck.playlistIdx : 0;
  const otherCount = (isA ? eng.deckB : eng.deckA)?.playlist?.length || 0;
  const engineStatus = engineScan && (
    <div className={`engine-scan-status ${engineScan.state}`} role="status" aria-live="polite">
      <div className="engine-scan-copy">
        <strong>{engineScan.message}</strong>
        {engineScan.detail && <small>{engineScan.detail}</small>}
      </div>
      {engineBusy && (
        <div className="engine-scan-progress" aria-label={`Engine DJ scan ${Math.round((engineScan.progress || 0) * 100)}%`}>
          <span style={{ width: `${Math.max(2, (engineScan.progress || 0) * 100)}%` }}></span>
        </div>
      )}
    </div>
  );

  return ReactDOM.createPortal(
      <div className="floating-window panel with-screws playlist-modal" role="dialog"
        aria-label={`Deck ${label} playlist`}
        style={fb.style}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        ref={dropRef}>
        <div className="screw-bl"></div><div className="screw-br"></div>

        <div className="modal-titlebar floating-titlebar" style={{ cursor: "move", touchAction: "none" }} onPointerDown={fb.startDrag}>
          <span className="modal-traffic">
            <button type="button" className="dot red" aria-label="Close playlist" onClick={onClose}></button>
            <span className="dot yellow" aria-hidden="true"></span>
            <span className="dot green" aria-hidden="true"></span>
          </span>
          <span className="panel-title">Playlist</span>

          <div className="pl-deck-tabs">
            <button className={`pl-deck-tab ${isA ? "active a" : ""}`}
              onClick={() => onSwitchDeck("A")}>
              DECK A · {(eng.deckA?.playlist || []).length}
            </button>
            <button className={`pl-deck-tab ${!isA ? "active b" : ""}`}
              onClick={() => onSwitchDeck("B")}>
              DECK B · {(eng.deckB?.playlist || []).length}
            </button>
            <button className={`pl-link-toggle ${playlistsLinked ? "active" : ""}`}
              aria-pressed={!!playlistsLinked}
              onClick={() => onTogglePlaylistLink?.(!playlistsLinked)}
              title={playlistsLinked
                ? "Both decks share this playlist order · click to separate"
                : "Deck playlists are separate · click to share this deck's order"}>
              {playlistsLinked ? "A ⇄ B · SHARED" : "A │ B · SEPARATE"}
            </button>
          </div>

          <button className="btn-xs btn" onClick={onClose}>ESC</button>
        </div>

        <div className="floating-body panel-body playlist-body">
          {/* Stats bar */}
          <div className="pl-stats" style={{ borderColor: accent }}>
            <span className="pl-stats-deck" style={{ color: accent }}>● {label}</span>
            <span className="pl-stats-count">{files.length} {files.length === 1 ? "track" : "tracks"}</span>
            <span className="pl-stats-dur">{fmtDur(totalDur)} total</span>
            <span className="pl-stats-now">
              {view === "saved"
                ? "BROWSING SAVED PLAYLISTS"
                : view === "library" ? "BROWSING PLAYLIST LIBRARY"
                : view === "rekordbox" ? "IMPORTING REKORDBOX ORDER"
                : files.length > 0 ? `Now: ${String(curIdx + 1).padStart(2, "0")} / ${String(files.length).padStart(2, "0")}` : "— empty —"}
            </span>
          </div>

          {/* Drop zone hint when dragging */}
          {dragOver && view === "list" && (
            <div className="pl-drop-overlay">
              <div className="pl-drop-msg">DROP TO ADD TO {label}</div>
            </div>
          )}

          {view === "list" ? (
            <React.Fragment>
              {files.length > 0 && (
                <input type="text" className="pl-filter mono" placeholder="🔍 filter tracks…"
                  value={plFilter} onChange={(e) => setPlFilter(e.target.value)} />
              )}
              {/* List */}
              <div className="pl-list">
                <div className="pl-list-head">
                  <span className="c-num">#</span>
                  <span className="c-state"></span>
                  <span className="c-art"></span>
                  <span className="c-name">NAME</span>
                  <span className="c-dur">TIME</span>
                  <span className="c-act"></span>
                </div>
                {files.length === 0 && (
                  <div className="pl-empty">
                    <div className="pl-empty-icon">♪</div>
                    <div className="pl-empty-title">No tracks loaded</div>
                    <div className="pl-empty-sub">Drag audio files anywhere · click <b>+ ADD</b> below · or <b>LOAD</b> a saved playlist</div>
                  </div>
                )}
                {files.map((file, i) => ({ file, i }))
                  .filter(({ file }) => !plFilter || `${file.name} ${file.engineDJ?.title || ""} ${file.engineDJ?.artist || ""}`.toLowerCase().includes(plFilter.toLowerCase()))
                  .map(({ file, i }) => {
                  const key = `${deckKey}|${i}|${file.name}|${file.size}`;
                  const dur = durations[key];
                  const info = { ...(metadata[trackKey(file)] || {}), ...(file.engineDJ || {}) };
                  const isCur = i === curIdx;
                  return (
                    <div key={trackKey(file) + i}
                      className={`pl-row ${isCur ? "current" : ""}`}
                      onDoubleClick={() => onLoad(i)}>
                      <span className="c-num">{String(i + 1).padStart(2, "0")}</span>
                      <span className="c-state">
                        {isCur && state.playing ? <span className="pl-playing">▶</span>
                          : isCur ? <span className="pl-cued">●</span>
                          : <span className="pl-idle"></span>}
                      </span>
                      <span className={`c-art ${info.artworkUrl ? "has-artwork" : ""}`}>
                        {info.artworkUrl
                          ? <img src={info.artworkUrl} alt="" draggable="false" />
                          : <span aria-hidden="true">♪</span>}
                      </span>
                      <span className="c-name" title={file.name}>
                        <b>{info.title || file.name}</b>
                        {(info.artist || info.album) && (
                          <small>{[info.artist, info.album].filter(Boolean).join(" · ")}</small>
                        )}
                        {info.hasStems && <small className="pl-stems-badge">4 STEMS</small>}
                      </span>
                      <span className="c-dur">{fmtDur(dur)}</span>
                      <span className="c-act">
                        <button className="pl-mini pl-load" title="Load paused" aria-label={`Load ${info.title || file.name} paused`}
                          onClick={() => onLoad(i, false)}>LOAD</button>
                        <button className="pl-mini" title="Load & play" onClick={() => onLoad(i)}>▶</button>
                        <button className="pl-mini" title="Move up" disabled={i === 0}
                          onClick={() => onMove(i, i - 1)}>↑</button>
                        <button className="pl-mini" title="Move down" disabled={i === files.length - 1}
                          onClick={() => onMove(i, i + 1)}>↓</button>
                        <button className="pl-mini danger" title="Remove"
                          onClick={() => onRemove(i)}>×</button>
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Save name prompt */}
              {saveNameOpen && (
                <div className="pl-save-prompt">
                  <span className="pl-save-prompt-label">SAVE AS</span>
                  <input
                    className="pl-save-input"
                    type="text"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmSave();
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        cancelSave();
                      }
                    }}
                    autoFocus
                    placeholder={defaultSaveName()}
                  />
                  <button className="pl-action primary" onClick={confirmSave}>SAVE</button>
                  <button className="pl-action" onClick={cancelSave}>CANCEL</button>
                </div>
              )}

              {/* Footer */}
              <div className="pl-footer">
                <label className="pl-action primary">
                  + ADD FILES
                  <input type="file" className="hidden" accept="audio/*" multiple onChange={onFileInput} />
                </label>
                <button className="pl-action" onClick={onShuffle} disabled={files.length < 2}>SHUFFLE</button>
                <button className="pl-action" onClick={openSavePrompt} disabled={files.length === 0}>SAVE</button>
                <button className="pl-action" onClick={openLoadView}>SAVED…</button>
                <button className="pl-action" onClick={openLibraryView}>LIBRARY…</button>
                <label className="pl-action rekordbox-action" title="Import playlist order from a Rekordbox XML export">
                  REKORDBOX XML
                  <input type="file" className="hidden" accept=".xml,text/xml,application/xml" multiple onChange={onRekordboxInput} />
                </label>
                <label className={`pl-action engine-action ${engineBusy ? "scanning" : ""}`} title="Read playlists, artwork and stems from an Engine DJ drive">
                  {engineBusy ? `${Math.round((engineScan.progress || 0) * 100)}% · ENGINE DJ` : "ENGINE DJ DRIVE"}
                  <input type="file" className="hidden" multiple webkitdirectory="" directory="" onChange={onEngineDriveInput} />
                </label>
                <button className="pl-action danger" onClick={onClear} disabled={files.length === 0}>CLEAR</button>
                <span className="pl-footer-hint">Drop audio files · 2× click row to load · ESC closes</span>
              </div>
              {engineStatus}
            </React.Fragment>
          ) : view === "library" ? (
            <div className="pl-saved">
              <div className="pl-saved-head">
                <span className="pl-saved-title">Playlist Library</span>
                <span className="pl-saved-count">{libraryPlaylists.length} playlists</span>
                <label className="pl-action" style={{ marginLeft: "auto" }}>
                  IMPORT XMLS
                  <input type="file" className="hidden" accept=".xml,text/xml,application/xml" multiple onChange={onRekordboxInput} />
                </label>
                <label className={`pl-action engine-action ${engineBusy ? "scanning" : ""}`}>
                  {engineBusy ? `${Math.round((engineScan.progress || 0) * 100)}% · ENGINE DJ` : "ENGINE DJ DRIVE"}
                  <input type="file" className="hidden" multiple webkitdirectory="" directory="" onChange={onEngineDriveInput} />
                </label>
              </div>
              {engineStatus}
              {libraryPlaylists.length === 0 ? (
                <div className="pl-empty"><div className="pl-empty-icon">⌘</div><div className="pl-empty-title">No playlists imported</div><div className="pl-empty-sub">Connect an Engine DJ drive or import Rekordbox XML exports to build your library.</div></div>
              ) : (
                <div className="engine-browser">
                  <aside className="engine-browser-tree" aria-label="Playlist library">
                    <div className="engine-browser-pane-head">
                      <span>PLAYLISTS</span>
                      <small>{libraryPlaylists.length}</small>
                    </div>
                    <div className="engine-browser-tree-scroll">
                      {libraryRows.map(({ kind, node, depth }) => kind === "folder" ? (() => {
                        const folderPlaylist = node.playlist;
                        const folderId = folderPlaylist?.id || folderPlaylist?.path || null;
                        const folderActive = folderId != null && folderId === selectedLibraryId;
                        return (
                          <button key={`folder:${node.path}`} className={`engine-browser-folder ${folderActive ? "active" : ""}`}
                            aria-pressed={folderId != null ? folderActive : undefined}
                            style={{ paddingLeft: `${9 + depth * 14}px` }}
                            onClick={() => {
                              if (folderId != null) setSelectedLibraryId(folderId);
                              setLibraryCollapsed((current) => {
                                const next = new Set(current);
                                if (next.has(node.path)) next.delete(node.path); else next.add(node.path);
                                return next;
                              });
                            }}>
                            <span className="pl-library-caret">{libraryCollapsed.has(node.path) ? "▸" : "▾"}</span>
                            <span className="engine-browser-icon">▰</span>
                            <strong>{node.name}</strong>
                            <small>{node.children.size}</small>
                          </button>
                        );
                      })() : (() => {
                        const playlist = node.playlist;
                        const id = playlist?.id || playlist?.path || node.path;
                        const active = id === selectedLibraryId;
                        return (
                          <button key={`playlist:${id}`} className={`engine-browser-playlist ${active ? "active" : ""}`}
                            style={{ paddingLeft: `${22 + depth * 14}px` }}
                            onClick={() => setSelectedLibraryId(id)}>
                            <span className={`engine-browser-source ${playlist?.source === "engine-dj" ? "engine" : "rekordbox"}`}>●</span>
                            <span className="engine-browser-playlist-copy">
                              <strong>{playlist?.name || node.name}</strong>
                              <small>{playlist?.tracks?.length || 0} tracks</small>
                            </span>
                            {playlist?.source === "engine-dj" && playlist?.tracks?.some((track) => track.hasStems) && (
                              <span className="engine-browser-stem-mark">S</span>
                            )}
                          </button>
                        );
                      })())}
                    </div>
                  </aside>

                  <section className="engine-browser-detail" aria-label="Selected playlist tracks">
                    {selectedLibraryPlaylist ? (() => {
                      const playlist = selectedLibraryPlaylist;
                      const liveFiles = playlist.files || [];
                      const catalogueTracks = playlist.trackRefs?.length ? playlist.trackRefs : (playlist.tracks || []);
                      const previewTracks = liveFiles.length
                        ? liveFiles.map((file, index) => ({ file, index, info: { ...(file.engineDJ || {}) } }))
                        : catalogueTracks.map((track, index) => ({
                          file: null,
                          index,
                          info: track && typeof track === "object"
                            ? track
                            : { name: String(track || ""), title: String(track || "") },
                        }));
                      const query = libraryTrackFilter.trim().toLowerCase();
                      const visibleTracks = sortLibraryTracks(previewTracks.filter(({ file, info }) => !query || (
                        `${info.title || file?.name || info.name || ""} ${info.artist || ""} ${info.album || ""} ${info.genre || ""}`.toLowerCase().includes(query)
                      )), libraryTrackSort);
                      const loadedHere = liveFiles.length === engDeck?.playlist?.length
                        && liveFiles.length > 0
                        && liveFiles.every((file, index) => file === engDeck.playlist[index]);
                      const stemCount = previewTracks.filter(({ info }) => info.hasStems).length;
                      return (
                        <React.Fragment>
                          <div className="engine-browser-detail-head">
                            <div className="engine-browser-title">
                              <span className={`pl-saved-deck ${playlist.source === "engine-dj" ? "engine" : "a"}`}>
                                {playlist.source === "engine-dj" ? "ENGINE DJ" : playlist.source === "rekordbox" ? "REKORDBOX" : "LOCAL"}
                              </span>
                              <strong>{playlist.name}</strong>
                              <small>{playlist.path || playlist.name}</small>
                            </div>
                            <div className="engine-browser-summary">
                              <span>{previewTracks.length} TRACKS</span>
                              {stemCount > 0 && <span className="stems">{stemCount} STEMS</span>}
                              {loadedHere && <span className="loaded">LOADED · DECK {deckKey}</span>}
                            </div>
                          </div>

                          <div className="engine-browser-toolbar">
                            <input className="pl-filter mono" type="search" placeholder="Filter this playlist…"
                              value={libraryTrackFilter} onChange={(event) => setLibraryTrackFilter(event.target.value)} />
                            {playlist.source === "engine-dj" ? (
                              <button className="pl-action primary" disabled={!liveFiles.length || engineBusy}
                                onClick={() => loadEnginePlaylist(playlist, { stayInLibrary: true })}>
                                LOAD PLAYLIST
                              </button>
                            ) : (
                              <button className="pl-action primary" onClick={() => beginReconcile(playlist)}>MATCH AUDIO</button>
                            )}
                          </div>

                          <div className="engine-track-table">
                            <div className="engine-track-head">
                              <span>{librarySortLabel("position", "#")}</span>
                              <span></span>
                              <span>{librarySortLabel("title", "TITLE / ARTIST")}</span>
                              <span>{librarySortLabel("bpm", "BPM")}</span>
                              <span>{librarySortLabel("duration", "TIME")}</span>
                              <span></span>
                            </div>
                            <div className="engine-track-scroll">
                              {visibleTracks.length ? visibleTracks.map(({ file, index, info }) => {
                                const title = info.title || file?.name || info.name || `Track ${index + 1}`;
                                const isCurrent = loadedHere && index === engDeck.playlistIdx;
                                return (
                                  <div key={`${trackKey(file) || title}:${index}`} className={`engine-track-row ${isCurrent ? "current" : ""}`}
                                    onDoubleClick={() => liveFiles.length && loadEnginePlaylist(playlist, { index, stayInLibrary: true })}>
                                    <span className="engine-track-number">{String(index + 1).padStart(2, "0")}</span>
                                    <span className={`c-art ${info.artworkUrl ? "has-artwork" : ""}`}>
                                      {info.artworkUrl ? <img src={info.artworkUrl} alt="" draggable="false" /> : <span aria-hidden="true">♪</span>}
                                    </span>
                                    <span className="engine-track-name" title={title}>
                                      <b>{title}</b>
                                      <small>{[info.artist, info.album].filter(Boolean).join(" · ") || file?.name || "Unknown artist"}</small>
                                      {info.hasStems && <i>4 STEMS</i>}
                                    </span>
                                    <span className="engine-track-bpm">{info.bpm ? Math.round(info.bpm) : "—"}</span>
                                    <span className="engine-track-time">{fmtDur(info.duration)}</span>
                                    <span className="engine-track-actions">
                                      <button className="pl-mini pl-load" disabled={!liveFiles.length || engineBusy}
                                        title={`Load ${title} paused`} onClick={() => loadEnginePlaylist(playlist, { index, stayInLibrary: true })}>LOAD</button>
                                      <button className="pl-mini" disabled={!liveFiles.length || engineBusy}
                                        title={`Load and play ${title}`} onClick={() => loadEnginePlaylist(playlist, { index, play: true, stayInLibrary: true })}>▶</button>
                                    </span>
                                  </div>
                                );
                              }) : (
                                <div className="pl-empty engine-track-empty">
                                  <div className="pl-empty-title">No matching tracks</div>
                                </div>
                              )}
                            </div>
                          </div>
                          {playlist.source === "engine-dj" && !liveFiles.length && (
                            <div className="engine-browser-offline">Reconnect the Engine DJ drive to load audio. Playlist structure remains available offline.</div>
                          )}
                        </React.Fragment>
                      );
                    })() : (
                      <div className="pl-empty"><div className="pl-empty-icon">♫</div><div className="pl-empty-title">Choose a playlist</div><div className="pl-empty-sub">Its tracks will appear here.</div></div>
                    )}
                  </section>
                </div>
              )}
              <div className="pl-footer"><button className="pl-action" onClick={closeLoadView}>← BACK TO {label}</button><span className="pl-footer-hint">Engine audio stays on the drive · stems decode only when a track is loaded</span></div>
            </div>
          ) : view === "saved" ? (
            // === SAVED PLAYLISTS VIEW ===
            <div className="pl-saved">
              {!reconcile ? (
                <React.Fragment>
                  <div className="pl-saved-head">
                    <span className="pl-saved-title">Saved Playlists</span>
                    <span className="pl-saved-count">{savedPlaylists.length} saved</span>
                    <label className="pl-action" style={{ marginLeft: "auto" }}>
                      IMPORT ZIP / JSON
                      <input type="file" className="hidden" accept=".zip,.json,application/zip,application/json" onChange={onImportInput} />
                    </label>
                    <button className="pl-action primary" onClick={exportZip} disabled={files.length === 0}>EXPORT ZIP</button>
                    <button className="pl-action" onClick={exportJson} disabled={files.length === 0}>EXPORT JSON</button>
                  </div>
                  {savedPlaylists.length === 0 ? (
                    <div className="pl-empty">
                      <div className="pl-empty-icon">⌬</div>
                      <div className="pl-empty-title">No saved playlists yet</div>
                      <div className="pl-empty-sub">Build a playlist, then click <b>SAVE</b> to keep it · or <b>EXPORT ZIP</b> to bundle audio + order into a single file</div>
                    </div>
                  ) : (
                    <div className="pl-saved-list">
                      {savedPlaylists.map((p) => (
                        <div key={p.id} className="pl-saved-row">
                          <div className="pl-saved-info">
                            <input
                              className="pl-saved-name"
                              defaultValue={p.name}
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                if (v && v !== p.name) renameSaved(p.id, v);
                              }} />
                            <div className="pl-saved-meta">
                              <span className={`pl-saved-deck ${p.deck === "A" ? "a" : "b"}`}>DECK {p.deck || "?"}</span>
                              <span>{p.tracks?.length || 0} tracks</span>
                              <span>{fmtSavedDate(p.created)}</span>
                            </div>
                            <div className="pl-saved-tracks" title={p.tracks?.join("\n")}>
                              {(p.tracks || []).slice(0, 3).join(" · ")}
                              {(p.tracks || []).length > 3 ? ` · +${p.tracks.length - 3} more` : ""}
                            </div>
                          </div>
                          <div className="pl-saved-actions">
                            <button className="pl-action primary" onClick={() => beginReconcile(p)}>LOAD →</button>
                            <button className="pl-mini danger" title="Delete saved playlist"
                              onClick={() => deleteSaved(p.id)}>×</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="pl-footer">
                    <button className="pl-action" onClick={closeLoadView}>← BACK TO {label}</button>
                    <span className="pl-footer-hint">SAVE = browser only · EXPORT ZIP = bundles audio for sharing</span>
                  </div>
                </React.Fragment>
              ) : (
                // === RECONCILE: pick files for a saved playlist ===
                (() => {
                  const matched = reconcile.tracks.filter(t => reconcile.pickedFiles[t.toLowerCase()]).length;
                  const total = reconcile.tracks.length;
                  const missingCount = total - matched;
                  return (
                    <React.Fragment>
                      <div className="pl-saved-head">
                        <span className="pl-saved-title">Loading: {reconcile.name}</span>
                        <span className="pl-saved-count">{matched} / {total} matched</span>
                      </div>
                      <div className="pl-reconcile-hint">
                        Pick the audio files for this playlist from disk. Match is by filename.
                        Drop files anywhere in this window, or click <b>SELECT FILES</b>. Order is restored from the save.
                      </div>
                      <div className="pl-list" style={{ minHeight: 220 }}>
                        <div className="pl-list-head">
                          <span className="c-num">#</span>
                          <span className="c-state"></span>
                          <span className="c-art"></span>
                          <span className="c-name">EXPECTED</span>
                          <span className="c-dur">STATUS</span>
                          <span className="c-act"></span>
                        </div>
                        {reconcile.tracks.map((name, i) => {
                          const found = !!reconcile.pickedFiles[name.toLowerCase()];
                          return (
                            <div key={i} className={`pl-row ${found ? "matched" : "unmatched"}`}>
                              <span className="c-num">{String(i + 1).padStart(2, "0")}</span>
                              <span className="c-state">
                                {found ? <span className="pl-playing" style={{ color: "#4ade80", animation: "none", textShadow: "none" }}>✓</span>
                                  : <span className="pl-cued" style={{ color: "#f59e0b" }}>?</span>}
                              </span>
                              <span className="c-art"><span aria-hidden="true">♪</span></span>
                              <span className="c-name" title={name}>{name}</span>
                              <span className="c-dur" style={{ color: found ? "#4ade80" : "#f59e0b" }}>
                                {found ? "FOUND" : "MISSING"}
                              </span>
                              <span className="c-act"></span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="pl-footer">
                        <label className="pl-action primary">
                          SELECT FILES
                          <input type="file" className="hidden" accept="audio/*" multiple
                            onChange={(e) => { onReconcileFiles(e.target.files); e.target.value = ""; }} />
                        </label>
                        <button className="pl-action"
                          onClick={() => applyReconcile(false)}
                          disabled={matched === 0 || missingCount > 0}>
                          LOAD ALL ({matched})
                        </button>
                        <button className="pl-action"
                          onClick={() => applyReconcile(true)}
                          disabled={matched === 0}>
                          LOAD AS-IS{missingCount ? ` · skip ${missingCount}` : ""}
                        </button>
                        <button className="pl-action" onClick={() => setReconcile(null)}>← BACK</button>
                        <span className="pl-footer-hint">Drop files anywhere · matching is case-insensitive by filename</span>
                      </div>
                    </React.Fragment>
                  );
                })()
              )}
            </div>
          ) : (
            // === REKORDBOX XML VIEW ===
            <div className="pl-rekordbox">
              <div className="pl-saved-head">
                <span className="pl-saved-title">Rekordbox XML</span>
                <span className="pl-saved-count">
                  {rekordboxImport?.sourceName || "No XML selected"}
                </span>
                <label className="pl-action" style={{ marginLeft: "auto" }}>
                  CHOOSE OTHER XML
                  <input type="file" className="hidden" accept=".xml,text/xml,application/xml" multiple onChange={onRekordboxInput} />
                </label>
              </div>
              <div className="rb-browser">
                <div className="rb-playlists" aria-label="Rekordbox playlists">
                  {(rekordboxImport?.playlists || []).map((playlist) => (
                    <button key={playlist.path}
                      className={selectedRekordbox?.path === playlist.path ? "active" : ""}
                      onClick={() => setRekordboxImport((current) => ({
                        ...current,
                        selectedPath: playlist.path,
                      }))}>
                      <span>{playlist.name}</span>
                      <small>{playlist.tracks.length} tracks · {playlist.path}</small>
                    </button>
                  ))}
                </div>
                <div className="rb-detail">
                  {selectedRekordbox ? (
                    <React.Fragment>
                      <div className="rb-detail-head">
                        <div>
                          <strong>{selectedRekordbox.name}</strong>
                          <span>{selectedRekordbox.path}</span>
                        </div>
                        <span className="rb-match-count">
                          {rekordboxLoadedMatch.ordered.length}/{selectedRekordbox.tracks.length} LOADED
                        </span>
                      </div>
                      <div className="rb-track-preview">
                        {selectedRekordbox.tracks.map((track, index) => (
                          <div key={`${track.id}-${index}`}>
                            <span>{String(index + 1).padStart(2, "0")}</span>
                            <div>
                              <b>{track.name || track.fileName}</b>
                              <small>{[track.artist, track.album].filter(Boolean).join(" · ") || track.fileName}</small>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="rb-actions">
                        <button className="pl-action primary"
                          disabled={!rekordboxLoadedMatch.ordered.length}
                          onClick={() => applyRekordboxOrder(engDeck?.playlist || [])}>
                          APPLY TO LOADED ({rekordboxLoadedMatch.ordered.length})
                        </button>
                        <label className="pl-action">
                          SELECT AUDIO FILES
                          <input type="file" className="hidden" accept="audio/*" multiple
                            onChange={(event) => {
                              applyRekordboxOrder(event.target.files);
                              event.target.value = "";
                            }} />
                        </label>
                        <label className="pl-action">
                          SELECT MUSIC FOLDER
                          <input type="file" className="hidden" accept="audio/*" multiple
                            webkitdirectory="" directory=""
                            onChange={(event) => {
                              applyRekordboxOrder(event.target.files);
                              event.target.value = "";
                            }} />
                        </label>
                      </div>
                      <p className="rb-help">
                        Dubnator matches Rekordbox locations to local filenames, restores this exact order,
                        and keeps the audio on your device. Missing tracks are reported but do not block the import.
                      </p>
                    </React.Fragment>
                  ) : (
                    <div className="pl-empty">
                      <div className="pl-empty-icon">⌁</div>
                      <div className="pl-empty-title">Choose a Rekordbox playlist</div>
                    </div>
                  )}
                </div>
              </div>
              <div className="pl-footer">
                <button className="pl-action" onClick={() => setView("list")}>← BACK TO {label}</button>
                <span className="pl-footer-hint">XML restores playlist order · audio files are matched locally</span>
              </div>
            </div>
          )}

          {/* Toast */}
          {toast && (
            <div className={`pl-toast pl-toast-${toast.kind}`}>{toast.msg}</div>
          )}
        </div>
        <div className="floating-resize" onPointerDown={fb.startResize} title="Drag to resize"></div>
      </div>,
    document.body
  );
}

window.DubnatorPlaylistModal = PlaylistModal;
