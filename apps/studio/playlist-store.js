// Best-effort local session library. File/Blob objects are structured-cloned by
// IndexedDB, allowing a reload to restore a local playlist without asking the
// user to pick the same files again. The app still works when IndexedDB is
// unavailable (private mode, older WebViews, or a restricted browser).
(function (scope) {
  const DB_NAME = "dubnator-library";
  const DB_VERSION = 1;
  const STORE = "sessions";
  let opening = null;

  function open() {
    if (opening) return opening;
    if (!scope.indexedDB) return Promise.resolve(null);
    opening = new Promise((resolve) => {
      let request;
      try { request = scope.indexedDB.open(DB_NAME, DB_VERSION); } catch (_) { resolve(null); return; }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return opening;
  }

  function transaction(deck, mode, action) {
    return open().then((db) => new Promise((resolve) => {
      if (!db) { resolve(null); return; }
      try {
        const request = action(db.transaction(STORE, mode).objectStore(STORE), deck);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    }));
  }

  function save(deck, files) {
    const list = Array.from(files || []).filter(Boolean);
    // Safari/WebKit can restore a structured-cloned File as a Blob (losing its
    // name). Store a tiny envelope so reloads always reconstruct usable Files.
    const records = list.map((file) => ({
      name: file.name || "track",
      type: file.type || "application/octet-stream",
      lastModified: Number(file.lastModified) || 0,
      blob: file,
    }));
    return transaction(deck, "readwrite", (store, key) => store.put(records, key));
  }
  function load(deck) {
    return transaction(deck, "readonly", (store, key) => store.get(key)).then((records) => {
      if (!Array.isArray(records)) return [];
      return records.map((record) => {
        // Migrate the original v1 format, which stored the File directly.
        if (!record || !record.blob) return record;
        try {
          if (typeof File === "function") return new File([record.blob], record.name, { type: record.type, lastModified: record.lastModified });
        } catch (_) {}
        return record.blob;
      }).filter(Boolean);
    });
  }
  function clear(deck) {
    return transaction(deck, "readwrite", (store, key) => store.delete(key));
  }
  function clearAll() {
    return open().then((db) => new Promise((resolve) => {
      if (!db) { resolve(null); return; }
      try {
        const request = db.transaction(STORE, "readwrite").objectStore(STORE).clear();
        request.onsuccess = () => resolve(true);
        request.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    }));
  }

  scope.DubnatorPlaylistStore = { save, load, clear, clearAll };
})(typeof window !== "undefined" ? window : self);
