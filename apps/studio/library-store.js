/* Persistent local playlist catalogue. Audio files remain in the deck/session
 * store; this catalogue keeps playlist folders, order and Rekordbox metadata
 * available between launches without duplicating a large library. */
(function (scope) {
  const DB_NAME = "dubnator-playlist-catalogue";
  const DB_VERSION = 2;
  const STORE = "catalogue";
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

  function transaction(mode, action) {
    return open().then((db) => new Promise((resolve) => {
      if (!db) { resolve(null); return; }
      try {
        const request = action(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    }));
  }

  function save(catalogue) {
    const value = {
      version: 1,
      updated: Date.now(),
      playlists: Array.isArray(catalogue?.playlists) ? catalogue.playlists : [],
    };
    return transaction("readwrite", (store) => store.put(value, "root"));
  }
  function load() {
    return transaction("readonly", (store) => store.get("root")).then((value) => (
      value && Array.isArray(value.playlists) ? value : { version: 1, updated: 0, playlists: [] }
    ));
  }
  function clear() { return transaction("readwrite", (store) => store.delete("root")); }

  scope.DubnatorLibraryStore = { save, load, clear };
})(typeof window !== "undefined" ? window : self);
