// Lists a shared Google Drive folder and downloads MP3 files from it, using the Drive v3 REST API.
// The API key is sent in the X-Goog-Api-Key header, never in the URL, so it does not end up in logs or history.
// The folder (and its files) must be shared as "Anyone with the link can view".

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const ID_RE = /^[A-Za-z0-9_-]{10,100}$/;
const FOLDER_MIME = "application/vnd.google-apps.folder";
const MAX_PAGES = 5;                       // 5 x 200 = 1000 entries per folder
const MAX_AUDIO_BYTES = 150 * 1024 * 1024; // refuse bigger MP3 files
const LIST_TIMEOUT_MS = 15000;
const AUDIO_TIMEOUT_MS = 5 * 60 * 1000;

// Errors with a message that is safe to show to the user.
export class DriveError extends Error {}

// Accepts a folder URL (.../folders/<id> or ...?id=<id>) or a bare folder id. Returns "" when it is neither.
export function extractFolderId(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  const m = v.match(/\/folders\/([A-Za-z0-9_-]+)/) || v.match(/[?&]id=([A-Za-z0-9_-]+)/);
  const id = m ? m[1] : v;
  return ID_RE.test(id) ? id : "";
}

export function isDriveId(value) { return ID_RE.test(value || ""); }

async function driveFetch(url, key, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { headers: { "X-Goog-Api-Key": key }, signal: ctrl.signal, cache: "no-store" });
  } catch (err) {
    console.error(err);
    throw new DriveError(ctrl.signal.aborted ? "Google Drive took too long to answer" : "Could not reach Google Drive");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    console.error("Drive request failed", res.status);
    if (res.status === 400 || res.status === 401) throw new DriveError("Google rejected the API key. Check it in Settings, and that the Drive API is enabled for it.");
    if (res.status === 403) throw new DriveError("Google Drive refused access. Share the folder as \"Anyone with the link can view\" and check the API key.");
    if (res.status === 404) throw new DriveError("Folder or file not found. Check the folder link and its sharing.");
    throw new DriveError(`Google Drive returned an error (${res.status})`);
  }
  return res;
}

// Returns [{ id, name, kind: "folder" | "audio" }], folders first, each group sorted by name.
export async function listFolder(folderId, key) {
  if (!ID_RE.test(folderId)) throw new DriveError("That does not look like a Google Drive folder link");
  if (!key) throw new DriveError("Add a Google API key in Settings");
  const items = [];
  let pageToken = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`, // folderId is validated above
      fields: "nextPageToken,files(id,name,mimeType)",
      pageSize: "200",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await driveFetch(`${DRIVE_API}?${params}`, key, LIST_TIMEOUT_MS);
    const data = await res.json();
    for (const f of Array.isArray(data.files) ? data.files : []) {
      if (typeof f.id !== "string" || !ID_RE.test(f.id) || typeof f.name !== "string") continue;
      if (f.mimeType === FOLDER_MIME) items.push({ id: f.id, name: f.name, kind: "folder" });
      else if (f.mimeType === "audio/mpeg" || /\.mp3$/i.test(f.name)) items.push({ id: f.id, name: f.name, kind: "audio" });
    }
    pageToken = typeof data.nextPageToken === "string" ? data.nextPageToken : "";
    if (!pageToken) break;
  }
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  return [...items.filter((i) => i.kind === "folder").sort(byName), ...items.filter((i) => i.kind === "audio").sort(byName)];
}

// Downloads one MP3 and returns it as a Blob. The key stays in the header, so the file is played from a blob: URL.
export async function fetchAudio(fileId, key) {
  if (!ID_RE.test(fileId)) throw new DriveError("Invalid file");
  const res = await driveFetch(`${DRIVE_API}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, key, AUDIO_TIMEOUT_MS);
  const length = Number(res.headers.get("content-length"));
  if (length > MAX_AUDIO_BYTES) throw new DriveError("This file is too large (150 MB maximum)");
  const blob = await res.blob();
  if (blob.size > MAX_AUDIO_BYTES) throw new DriveError("This file is too large (150 MB maximum)");
  return new Blob([blob], { type: "audio/mpeg" });
}
