// Stores large media (videos, PowerPoint slide images) in IndexedDB, which allows far more data than localStorage.
// The operator page and the output window share this store because they have the same origin.

const DB_NAME = "presentation-media";
const STORE = "media";
export const MEDIA_ID_RE = /^m-[a-z0-9-]{8,60}$/;

// An error whose message is safe and useful to show to the user.
export class ImportError extends Error {}

let dbPromise = null;
const urlCache = new Map(); // id -> object URL

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function putMedia(blob) {
  const id = `m-${crypto.randomUUID()}`;
  await run("readwrite", (s) => s.put(blob, id));
  return id;
}

export async function getMediaBlob(id) {
  if (!MEDIA_ID_RE.test(id)) return null;
  return (await run("readonly", (s) => s.get(id))) || null;
}

// Returns an object URL for the stored blob (cached), or "" if it is missing.
export async function getMediaUrl(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const blob = await getMediaBlob(id);
  if (!blob) return "";
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

export async function deleteMedia(id) {
  if (!MEDIA_ID_RE.test(id)) return;
  await run("readwrite", (s) => s.delete(id));
  const url = urlCache.get(id);
  if (url) { URL.revokeObjectURL(url); urlCache.delete(id); }
}

// Deletes every stored item whose id is not in `keep` (a Set).
export async function pruneMedia(keep) {
  const ids = await run("readonly", (s) => s.getAllKeys());
  for (const id of ids || []) if (!keep.has(id)) await deleteMedia(id);
}

// Decodes an image blob, downsizes it, and returns it re-encoded as JPEG.
export async function imageToJpegBlob(blob, maxEdge = 1600) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Image encode failed"))), "image/jpeg", 0.85));
  } finally {
    URL.revokeObjectURL(url);
  }
}
