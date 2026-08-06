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
    return transaction(deck, "readwrite", (store, key) => store.put(list, key));
  }
  function load(deck) {
    return transaction(deck, "readonly", (store, key) => store.get(key)).then((files) => (
      Array.isArray(files) ? files : []
    ));
  }
  function clear(deck) {
    return transaction(deck, "readwrite", (store, key) => store.delete(key));
  }

  scope.DubnatorPlaylistStore = { save, load, clear };
})(typeof window !== "undefined" ? window : self);
