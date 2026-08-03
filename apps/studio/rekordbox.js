/* Rekordbox XML playlist importer. The XML supplies collection order; audio
 * remains local and is matched by decoded path/filename in the browser. */
(function () {
  "use strict";

  const normalize = (value) => String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase();

  function decodedPath(location) {
    if (!location) return "";
    try {
      const url = new URL(location);
      return decodeURIComponent(url.pathname || "").replace(/^\/([a-z]):\//i, "$1:/");
    } catch (_) {
      try { return decodeURIComponent(String(location)); } catch (_) { return String(location); }
    }
  }

  const baseName = (path) => String(path || "").replace(/\\/g, "/").split("/").pop() || "";

  function parse(xmlText) {
    const doc = new DOMParser().parseFromString(String(xmlText || ""), "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Invalid Rekordbox XML");
    const tracks = new Map();
    doc.querySelectorAll("COLLECTION > TRACK").forEach((node) => {
      const location = node.getAttribute("Location") || "";
      const path = decodedPath(location);
      const track = {
        id: node.getAttribute("TrackID") || "",
        name: node.getAttribute("Name") || baseName(path),
        artist: node.getAttribute("Artist") || "",
        album: node.getAttribute("Album") || "",
        bpm: Number(node.getAttribute("AverageBpm")) || null,
        location,
        path,
        fileName: baseName(path),
      };
      if (track.id) tracks.set(track.id, track);
    });

    const playlists = [];
    const roots = doc.querySelectorAll("PLAYLISTS > NODE");
    const visit = (node, parents) => {
      const name = node.getAttribute("Name") || "Untitled";
      const type = node.getAttribute("Type");
      const path = [...parents, name];
      const refs = Array.from(node.children || [])
        .filter((child) => child.tagName === "TRACK")
        .map((child) => tracks.get(child.getAttribute("Key")))
        .filter(Boolean);
      if (type === "1" || refs.length) {
        playlists.push({ name, path: path.join(" / "), tracks: refs });
      }
      Array.from(node.children || [])
        .filter((child) => child.tagName === "NODE")
        .forEach((child) => visit(child, path));
    };
    roots.forEach((node) => visit(node, []));
    return { tracks: Array.from(tracks.values()), playlists };
  }

  function aliasesForFile(file) {
    const relative = file?.webkitRelativePath || "";
    return new Set([
      normalize(file?.name),
      normalize(baseName(relative)),
      normalize(relative.replace(/\\/g, "/")),
    ].filter(Boolean));
  }

  function matchPlaylistFiles(playlist, filesInput) {
    const files = Array.from(filesInput || []);
    const available = files.map((file, index) => ({ file, index, aliases: aliasesForFile(file), used: false }));
    const ordered = [];
    const missing = [];
    (playlist?.tracks || []).forEach((track) => {
      const fileName = normalize(track.fileName || baseName(track.path));
      const fullPath = normalize(String(track.path || "").replace(/\\/g, "/").replace(/^\/+/, ""));
      let found = available.find((entry) => !entry.used && (
        entry.aliases.has(fileName)
        || (fullPath && Array.from(entry.aliases).some((alias) => fullPath.endsWith(alias)))
      ));
      if (!found && track.name) {
        const stem = normalize(fileName.replace(/\.[^.]+$/, ""));
        found = available.find((entry) => !entry.used && Array.from(entry.aliases).some((alias) => (
          alias.replace(/\.[^.]+$/, "") === stem
        )));
      }
      if (found) {
        found.used = true;
        ordered.push(found.file);
      } else missing.push(track);
    });
    return {
      ordered,
      missing,
      unused: available.filter((entry) => !entry.used).map((entry) => entry.file),
    };
  }

  window.DubnatorRekordbox = { parse, matchPlaylistFiles, decodedPath, baseName, normalize };
})();
