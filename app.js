import { CHANNEL_NAME, applyTheme, renderSlide, videoCommand, unlockSound } from "./screen.js";
import { MEDIA_ID_RE, ImportError, putMedia, getMediaUrl, deleteMedia, pruneMedia, imageToJpegBlob } from "./media.js";
import { readPresentation } from "./pptx.js";
import { DriveError, extractFolderId, isDriveId, listFolder, fetchAudio } from "./drive.js";

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "presentation-settings-v1";
const SETLIST_KEY = "presentation-setlist-v1";
const AUDIOSET_KEY = "presentation-audioset-v1";
const CUSTOM_KEY = "presentation-custom-v1";
const ESV_KEY_STORAGE = "presentation-esv-key-v1"; // API key entered by the user; never stored in config.json
const DRIVE_KEY_STORAGE = "presentation-drive-key-v1"; // Google API key for the Drive folder; never stored in config.json
const ESV_REF_RE = /^[A-Za-z0-9\s:;,.\-\u2013]+$/;
const MAX_SETLIST = 500;
const MAX_CUSTOM = 200;
const MAX_CUSTOM_TEXT = 20000;
const MAX_IMAGE_FILE = 15 * 1024 * 1024; // picked file size limit
const MAX_IMAGE_EDGE = 1600;             // images are downscaled to this on import
const BG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_VIDEO_FILE = 2 * 1024 * 1024 * 1024; // 2 GB
const MAX_DECK_SLIDES = 300;
const MAX_DECK_TEXT = 5000;
const SHEET_ID_RE = /^[A-Za-z0-9_-]{10,100}$/;
const GID_RE = /^\d{1,20}$/;

const channel = new BroadcastChannel(CHANNEL_NAME);
const previewEl = $("preview");

let config = null;
let songs = [];
let song = null;
let slides = [];
let index = 0;
let blank = true;
let linesPerSlide = 0;
let customs = [];   // saved custom slides: [{ title, lyrics, author: "", custom: true }]
let editing = null; // custom slide currently loaded in the editor, if any
let customBg = "";  // background image (data URL) currently chosen in the editor
let customMedia = null; // video or PowerPoint chosen in the editor: { video, deck, muted, name }
let importing = false;  // true while a video/PowerPoint is being stored (blocks cleanup)
let videoPaused = false; // operator pressed Pause on the current video
let lastVideoKey = "";
let live = true;      // true: the output window shows the current slide; false: the output window stays blank
let lastSent = null;  // last message sent to the output window
let esvKey = "";
let driveFolderId = ""; // root Google Drive folder
let driveFolderBad = false; // the folder box holds something that is not a Drive folder link
let driveKey = "";
let drivePath = [];     // folders entered below the root: [{ id, name }]
let driveItems = [];    // current folder listing: [{ id, name, kind }]
let driveLoaded = "";   // "folder|key" the listing was last loaded for
let driveToken = 0;     // newest listing request; older answers are ignored
let playToken = 0;      // newest play request; older downloads are ignored
let playingId = "";     // Drive file id loaded into the audio player
let audioSet = [];      // audio set list: [{ id, name }] Drive files, in play order
let audioIndex = -1;    // position in audioSet of the track in the player, -1 if none
let audioUrl = "";      // blob: URL of that file
let esvPending = null; // last fetched ESV passage, not yet saved: same shape as a custom slide
let setlist = [];   // [{ title, author, custom }] references into the song library
let setIndex = -1;  // position in setlist of the song being shown, -1 if none

// ---------- Config & settings ----------
async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return res.json();
}

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function extractSheetId(value) {
  const v = value.trim();
  const m = v.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : v;
}

function currentTheme() { return config.theme; }

function fillSettingsForm() {
  $("sheet-id").value = config.sheet.id;
  $("sheet-gid").value = config.sheet.gid;
  $("lines").value = linesPerSlide;
  $("bg").value = config.theme.background;
  $("fg").value = config.theme.color;
  $("size").value = config.theme.fontSize;
  $("align").value = config.theme.align;
  $("uppercase").checked = config.theme.uppercase;
  $("show-title").checked = config.theme.showTitle;
  $("esv-key").value = esvKey;
  renderBlankImageInfo();
  $("drive-folder").value = driveFolderId ? `https://drive.google.com/drive/folders/${driveFolderId}` : "";
  $("drive-key").value = driveKey;
}

function readSettingsForm() {
  config.sheet.id = extractSheetId($("sheet-id").value);
  config.sheet.gid = $("sheet-gid").value.trim() || "0";
  linesPerSlide = Math.max(0, Math.min(20, parseInt($("lines").value, 10) || 0));
  const t = config.theme;
  t.background = $("bg").value;
  t.color = $("fg").value;
  t.fontSize = Math.max(2, Math.min(20, parseFloat($("size").value) || 7));
  t.align = ["left", "center", "right"].includes($("align").value) ? $("align").value : "center";
  t.uppercase = $("uppercase").checked;
  t.showTitle = $("show-title").checked;
  esvKey = $("esv-key").value.trim();
  const folderText = $("drive-folder").value.trim();
  driveFolderId = extractFolderId(folderText);
  driveFolderBad = Boolean(folderText) && !driveFolderId;
  driveKey = $("drive-key").value.trim();
}

function persist() {
  if (esvKey) localStorage.setItem(ESV_KEY_STORAGE, esvKey);
  else localStorage.removeItem(ESV_KEY_STORAGE);
  if (driveKey) localStorage.setItem(DRIVE_KEY_STORAGE, driveKey);
  else localStorage.removeItem(DRIVE_KEY_STORAGE);
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    sheet: { id: config.sheet.id, gid: config.sheet.gid },
    drive: { folder: driveFolderId },
    theme: config.theme,
    linesPerSlide,
  }));
}

// ---------- Google Sheet loading ----------
// Uses the Google Visualization endpoint, which returns JSON wrapped in a JS callback.
async function loadFromSheet() {
  const { id, gid, titleColumn, lyricsColumn, authorColumn, timeoutMs } = config.sheet;
  if (!SHEET_ID_RE.test(id)) throw new Error("Invalid sheet ID");
  if (!GID_RE.test(gid)) throw new Error("Invalid gid");

  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/gviz/tq` +
    `?tqx=out:json&headers=1&gid=${encodeURIComponent(gid)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 10000);
  let text;
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`Sheet request failed (${res.status})`);
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Unexpected sheet response");
  const data = JSON.parse(text.slice(start, end + 1));
  if (data.status === "error") throw new Error("Sheet returned an error");

  const cols = data.table.cols.map((c) => (c.label || "").trim().toLowerCase());
  const iTitle = cols.indexOf(titleColumn.toLowerCase());
  const iLyrics = cols.indexOf(lyricsColumn.toLowerCase());
  const iAuthor = cols.indexOf(authorColumn.toLowerCase());
  if (iTitle < 0 || iLyrics < 0) {
    throw new Error(`Columns "${titleColumn}" and "${lyricsColumn}" not found in first row`);
  }

  const cell = (row, i) => (i >= 0 && row.c[i] && row.c[i].v != null ? String(row.c[i].v) : "");
  return data.table.rows
    .map((row) => ({
      title: cell(row, iTitle).trim(),
      lyrics: cell(row, iLyrics),
      author: cell(row, iAuthor).trim(),
    }))
    .filter((s) => s.title && s.lyrics.trim());
}

async function loadSongs() {
  setStatus("Loading songs…");
  try {
    if (config.sheet.id) {
      songs = await loadFromSheet();
      setStatus(`${songs.length} songs from Google Sheet`);
    } else {
      songs = (await fetchJson(config.fallbackSongsFile)).songs;
      setStatus(`${songs.length} songs from ${config.fallbackSongsFile} (no sheet set)`);
    }
  } catch (err) {
    console.error(err);
    try {
      songs = (await fetchJson(config.fallbackSongsFile)).songs;
      setStatus(`Sheet unavailable; using ${config.fallbackSongsFile} (${err.message})`);
    } catch (err2) {
      console.error(err2);
      songs = [];
      setStatus("Could not load any songs");
    }
  }
  renderSongList();
  renderSetlist();
}

function setStatus(msg) { $("status").textContent = msg; }

// ---------- Slides ----------
// Returns slide objects: { text, isTitle }. A title slide comes first when enabled.
function buildSlides(s) {
  if (s.video) return [{ text: s.lyrics.trim(), isTitle: false, video: s.video, muted: Boolean(s.muted) }];
  if (s.deck && s.deck.length) return s.deck.map((d) => ({ text: d.text, isTitle: false, image: d.image }));

  const blocks = s.lyrics.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const out = [];
  if (config.theme.showTitle && !s.custom) out.push({ text: s.title, isTitle: true });
  if (!blocks.length && s.bg) out.push({ text: "", isTitle: false }); // image-only slide
  for (const block of blocks) {
    if (!linesPerSlide) { out.push({ text: block, isTitle: false }); continue; }
    const lines = block.split("\n");
    for (let i = 0; i < lines.length; i += linesPerSlide) {
      out.push({ text: lines.slice(i, i + linesPerSlide).join("\n"), isTitle: false });
    }
  }
  return out;
}

// Rebuild slides for the current song after a settings change, keeping the same lyric slide if possible.
function rebuildSlides(hadTitle) {
  if (!song) return;
  const lyricPos = Math.max(0, index - (hadTitle && !song.custom ? 1 : 0));
  slides = buildSlides(song);
  index = Math.min(slides.length - 1, lyricPos + (config.theme.showTitle && !song.custom ? 1 : 0));
  index = Math.max(0, index);
  renderSlideList();
}

// ---------- Set list ----------
function loadSetlist() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETLIST_KEY));
    setlist = sanitizeSetlist(raw);
  } catch {
    setlist = [];
  }
}

function sanitizeSetlist(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x) => x && typeof x.title === "string")
    .slice(0, MAX_SETLIST)
    .map((x) => ({
      title: x.title.slice(0, 300),
      author: typeof x.author === "string" ? x.author.slice(0, 300) : "",
      custom: x.custom === true,
    }));
}

function saveSetlist() {
  localStorage.setItem(SETLIST_KEY, JSON.stringify(setlist));
}

function library() { return [...customs, ...songs]; }

function findSong(ref) {
  return library().find((s) =>
    Boolean(s.custom) === ref.custom && s.title === ref.title && (s.author || "") === ref.author) || null;
}

function addToSetlist(s) {
  if (setlist.length >= MAX_SETLIST) return;
  setlist.push({ title: s.title, author: s.author || "", custom: Boolean(s.custom) });
  saveSetlist();
  renderSetlist();
}

function removeFromSetlist(i) {
  setlist.splice(i, 1);
  if (setIndex === i) setIndex = -1;
  else if (setIndex > i) setIndex -= 1;
  saveSetlist();
  renderSetlist();
}

function moveInSetlist(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= setlist.length) return;
  [setlist[i], setlist[j]] = [setlist[j], setlist[i]];
  if (setIndex === i) setIndex = j;
  else if (setIndex === j) setIndex = i;
  saveSetlist();
  renderSetlist();
}

function playSetlistItem(i, lastSlide = false) {
  const s = findSong(setlist[i]);
  if (!s) return false;
  selectSong(s, i);
  if (lastSlide) { index = Math.max(0, slides.length - 1); renderSlideList(); publish(); }
  return true;
}

// Move to the next/previous playable song in the set list.
function goSong(delta, lastSlide = false) {
  if (!setlist.length) return;
  let i = setIndex < 0 ? (delta > 0 ? -1 : setlist.length) : setIndex;
  for (i += delta; i >= 0 && i < setlist.length; i += delta) {
    if (playSetlistItem(i, lastSlide)) return;
  }
}

function renderSetlist() {
  const list = $("setlist");
  list.replaceChildren();
  $("set-count").textContent = setlist.length ? `(${setlist.length})` : "";
  if (!setlist.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Empty. Press + on a song to add it.";
    list.append(li);
    return;
  }
  setlist.forEach((ref, i) => {
    const li = document.createElement("li");
    const found = findSong(ref);
    if (!found) li.classList.add("missing");
    if (i === setIndex) li.classList.add("active");

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = found ? ref.title : `${ref.title} (not found)`;
    li.append(name);

    const mk = (label, title, fn) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
      return b;
    };
    li.append(
      mk("\u2191", "Move up", () => moveInSetlist(i, -1)),
      mk("\u2193", "Move down", () => moveInSetlist(i, 1)),
      mk("\u00D7", "Remove from set list", () => removeFromSetlist(i)),
    );
    li.addEventListener("click", () => playSetlistItem(i));
    list.append(li);
  });
}

function exportSetlist() {
  const blob = new Blob([JSON.stringify({ setlist }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "setlist.json";
  a.click();
  URL.revokeObjectURL(url);
}

async function importSetlist(file) {
  if (!file || file.size > 1_000_000) { setStatus("Set list file is invalid or too large"); return; }
  try {
    const data = JSON.parse(await file.text());
    const items = sanitizeSetlist(Array.isArray(data) ? data : data.setlist);
    if (!items.length) throw new Error("empty");
    setlist = items;
    setIndex = -1;
    saveSetlist();
    renderSetlist();
    setStatus(`Imported ${items.length} songs into the set list`);
  } catch {
    setStatus("Could not read set list file");
  }
}

function selectSong(s, setPos = -1) {
  song = s;
  setIndex = setPos;
  slides = buildSlides(s);
  index = 0;
  blank = false;
  $("current-title").textContent = s.author ? `${s.title} — ${s.author}` : s.title;
  renderSongList();
  renderSetlist();
  renderSlideList();
  publish();
}

function go(delta) {
  if (!song) return;
  const next = index + delta;
  if (next >= slides.length) { if (setIndex >= 0) goSong(1); return; }
  if (next < 0) { if (setIndex >= 0) goSong(-1, true); return; }
  index = next;
  blank = false;
  renderSlideList();
  publish();
}

function toggleBlank() {
  blank = !blank;
  $("blank").classList.toggle("active", blank);
  publish();
}

// ---------- Rendering (operator) ----------
function renderSongList() {
  const q = $("search").value.trim().toLowerCase();
  const list = $("songs");
  list.replaceChildren();
  const shown = library().filter((s) =>
    !q || `${s.title} ${s.author || ""} ${s.lyrics}`.toLowerCase().includes(q));
  if (!shown.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No songs";
    list.append(li);
    return;
  }
  for (const s of shown) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = s.title;
    if (s.author || s.custom) {
      const a = document.createElement("span");
      a.className = "author";
      a.textContent = s.custom ? customLabel(s) : s.author;
      name.append(a);
    }
    const mk = (cls, label, title, fn) => {
      const b = document.createElement("button");
      b.className = cls;
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
      return b;
    };
    li.append(name);
    if (s.custom) {
      li.append(
        mk("add", "\u270E", "Edit custom slide", () => editCustom(s)),
        mk("add", "\u00D7", "Delete custom slide", () => deleteCustom(s)),
      );
    }
    li.append(mk("add", "+", "Add to set list", () => addToSetlist(s)));
    if (s === song) li.classList.add("active");
    // The library never drives the output; only set list items do. Double-click adds to the set list.
    li.addEventListener("dblclick", (e) => { if (!e.target.closest("button")) addToSetlist(s); });
    list.append(li);
  }
}

function renderSlideList() {
  const list = $("slides");
  list.replaceChildren();
  slides.forEach((slide, i) => {
    const li = document.createElement("li");
    if (i === index) li.classList.add("active");
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = slide.isTitle ? "Title" : `Slide ${i + 1 - (slides[0].isTitle ? 1 : 0)}`;
    const fallback = slide.video ? "(video)" : slide.image ? "(picture)" : "(image only)";
    li.append(label, document.createTextNode(slide.text || fallback));
    li.addEventListener("click", () => { index = i; blank = false; renderSlideList(); publish(); });
    list.append(li);
  });
  const active = list.querySelector(".active");
  if (active) active.scrollIntoView({ block: "nearest" });
}

function currentState() {
  return {
    title: song ? song.title : "",
    author: song ? song.author || "" : "",
    index,
    isTitle: Boolean(slides[index] && slides[index].isTitle),
    text: slides[index] ? slides[index].text : "",
    video: slides[index] && slides[index].video ? slides[index].video : "",
    image: slides[index] && slides[index].image ? slides[index].image : "",
    muted: Boolean(slides[index] && slides[index].muted),
    paused: videoPaused,
    bg: song && song.bg ? song.bg : "",
    dim: song && song.bg ? song.dim : 0,
    blank: blank || !song,
  };
}

function publish() {
  const state = currentState();
  if (state.video !== lastVideoKey) { lastVideoKey = state.video; videoPaused = false; state.paused = false; }
  $("video-controls").hidden = !state.video;
  $("video-play").textContent = videoPaused ? "Play (K)" : "Pause (K)";
  $("blank").classList.toggle("active", state.blank);
  // The output window is always silent; the sound of a video plays here, in the window the operator has clicked
  // (browsers only allow sound after a click). It is muted while Live is off, so nothing is heard that the audience is not shown.
  renderSlide(previewEl, state, currentTheme(), { mute: !live });
  // The preview always shows the current slide. While Live is off, the output window gets a blank screen instead.
  lastSent = { state: live ? state : { ...state, blank: true }, theme: currentTheme() };
  channel.postMessage(lastSent);
}

// cmd: "toggle" | "restart"
function sendVideo(cmd) {
  if (!lastVideoKey) return;
  let wire = cmd;
  if (cmd === "toggle") { videoPaused = !videoPaused; wire = videoPaused ? "pause" : "play"; }
  else if (cmd === "restart") videoPaused = false;
  $("video-play").textContent = videoPaused ? "Play (K)" : "Pause (K)";
  videoCommand(previewEl, wire);
  if (live) channel.postMessage({ cmd: wire });
}

function toggleLive() {
  live = !live;
  $("live").classList.toggle("active", live);
  $("live").setAttribute("aria-pressed", String(live));
  previewEl.classList.toggle("live", live);
  publish(); // going live sends the current slide to the output; going off blanks it
}

// If the browser still blocked the sound (no click or key press yet), the next one turns it on.
document.addEventListener("pointerdown", () => unlockSound(previewEl));
document.addEventListener("keydown", () => unlockSound(previewEl));

// ---------- Google Drive audio ----------
function driveMessage(msg) {
  const el = $("drive-status");
  el.textContent = msg;
  el.hidden = !msg;
}

function driveErrorText(err) {
  if (err instanceof DriveError) return err.message;
  console.error(err);
  return "Something went wrong with Google Drive";
}

function renderDrive() {
  $("drive-path").textContent = driveFolderId ? ["Folder", ...drivePath.map((p) => p.name)].join(" / ") : "";
  $("drive-refresh").disabled = !driveFolderId || !driveKey;
  const list = $("drive-files");
  list.replaceChildren();
  if (drivePath.length) {
    const up = document.createElement("li");
    up.className = "folder";
    up.textContent = "\u2190 Back";
    up.addEventListener("click", () => { drivePath.pop(); $("drive-search").value = ""; refreshDrive(true); });
    list.append(up);
  }
  const query = $("drive-search").value.trim().toLowerCase();
  const shown = query ? driveItems.filter((item) => item.name.toLowerCase().includes(query)) : driveItems;
  if (query && driveItems.length && !shown.length) {
    const none = document.createElement("li");
    none.className = "none";
    none.textContent = "No matches in this folder";
    list.append(none);
  }
  for (const item of shown) {
    const li = document.createElement("li");
    li.className = item.kind;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = item.kind === "folder" ? `\u{1F4C1} ${item.name}` : `\u266A ${item.name.replace(/\.mp3$/i, "")}`;
    li.append(name);
    if (item.kind === "folder") {
      li.addEventListener("click", () => { drivePath.push({ id: item.id, name: item.name }); $("drive-search").value = ""; refreshDrive(true); });
    } else {
      // Like the song library: clicking does not play. + or double-click adds the track to the audio set list.
      const add = document.createElement("button");
      add.className = "add";
      add.textContent = "+";
      add.title = "Add to audio set list";
      add.addEventListener("click", (e) => { e.stopPropagation(); addToAudioSet(item); });
      li.append(add);
      li.addEventListener("dblclick", (e) => { if (!e.target.closest("button")) addToAudioSet(item); });
    }
    list.append(li);
  }
}

// Loads the listing of the current folder. Without force it does nothing when it is already loaded.
async function refreshDrive(force) {
  if (driveFolderBad) { driveItems = []; renderDrive(); driveMessage("That is not a Google Drive folder link. Fix it in Settings."); return; }
  if (!driveFolderId) { driveItems = []; renderDrive(); driveMessage("Add a Google Drive folder URL in Settings (burger menu)."); return; }
  if (!driveKey) { driveItems = []; renderDrive(); driveMessage("Add a Google API key in Settings to list the folder."); return; }
  const folder = drivePath.length ? drivePath[drivePath.length - 1].id : driveFolderId;
  const signature = `${folder}|${driveKey}`;
  if (!force && signature === driveLoaded) return;
  const token = ++driveToken;
  driveMessage("Loading folder\u2026");
  try {
    const items = await listFolder(folder, driveKey);
    if (token !== driveToken) return;
    driveItems = items;
    driveLoaded = signature;
    renderDrive();
    driveMessage(items.length ? "" : "No MP3 files or folders here.");
  } catch (err) {
    if (token !== driveToken) return;
    driveItems = [];
    driveLoaded = "";
    renderDrive();
    driveMessage(driveErrorText(err));
  }
}

// ---------- Audio set list ----------
const trackTitle = (name) => name.replace(/\.mp3$/i, "");

function loadAudioSet() {
  try {
    const raw = JSON.parse(localStorage.getItem(AUDIOSET_KEY));
    audioSet = Array.isArray(raw)
      ? raw.filter((x) => x && typeof x.id === "string" && isDriveId(x.id) && typeof x.name === "string")
        .slice(0, MAX_SETLIST).map((x) => ({ id: x.id, name: x.name.slice(0, 300) }))
      : [];
  } catch {
    audioSet = [];
  }
}

function saveAudioSet() {
  localStorage.setItem(AUDIOSET_KEY, JSON.stringify(audioSet));
}

function addToAudioSet(item) {
  if (audioSet.length >= MAX_SETLIST) return;
  audioSet.push({ id: item.id, name: item.name });
  saveAudioSet();
  renderAudioSet();
}

function removeFromAudioSet(i) {
  audioSet.splice(i, 1);
  if (audioIndex === i) audioIndex = -1; // the track already in the player keeps playing
  else if (audioIndex > i) audioIndex -= 1;
  saveAudioSet();
  renderAudioSet();
}

function moveInAudioSet(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= audioSet.length) return;
  [audioSet[i], audioSet[j]] = [audioSet[j], audioSet[i]];
  if (audioIndex === i) audioIndex = j;
  else if (audioIndex === j) audioIndex = i;
  saveAudioSet();
  renderAudioSet();
}

function renderAudioSet() {
  const list = $("aset-list");
  list.replaceChildren();
  $("aset-count").textContent = audioSet.length ? `(${audioSet.length})` : "";
  $("aset-prev").disabled = $("aset-next").disabled = !audioSet.length;
  if (!audioSet.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Empty. Press + on a Google Drive track to add it.";
    list.append(li);
    return;
  }
  audioSet.forEach((track, i) => {
    const li = document.createElement("li");
    if (i === audioIndex) li.classList.add("active");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = trackTitle(track.name);
    li.append(name);
    const mk = (label, title, fn) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
      return b;
    };
    li.append(
      mk("\u2191", "Move up", () => moveInAudioSet(i, -1)),
      mk("\u2193", "Move down", () => moveInAudioSet(i, 1)),
      mk("\u00D7", "Remove from audio set list", () => removeFromAudioSet(i)),
    );
    li.addEventListener("click", () => playAudioAt(i));
    list.append(li);
  });
}

// Plays the audio set list entry at position i.
async function playAudioAt(i) {
  const track = audioSet[i];
  if (!track) return;
  const audio = $("drive-audio");
  const token = ++playToken;
  audioIndex = i;
  renderAudioSet();
  $("drive-player").hidden = false;
  if (track.id === playingId && audioUrl) { // already downloaded: just restart it
    $("drive-now").textContent = trackTitle(track.name);
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  $("drive-now").textContent = `Loading ${trackTitle(track.name)}\u2026`;
  try {
    const blob = await fetchAudio(track.id, driveKey);
    if (token !== playToken) return; // another track was chosen meanwhile
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(blob);
    playingId = track.id;
    audio.src = audioUrl;
    $("drive-now").textContent = trackTitle(track.name);
    audio.play().catch(() => { $("drive-now").textContent = `${trackTitle(track.name)} (press play)`; });
  } catch (err) {
    if (token !== playToken) return;
    $("drive-now").textContent = driveErrorText(err);
  }
}

// Next / previous track in the audio set list.
function goTrack(delta) {
  if (!audioSet.length) return;
  const i = audioIndex < 0 ? (delta > 0 ? 0 : audioSet.length - 1) : audioIndex + delta;
  if (i >= 0 && i < audioSet.length) playAudioAt(i);
}
// ---------- Custom slides ----------
function loadCustoms() {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY));
    customs = Array.isArray(raw)
      ? raw
          .filter((x) => x && typeof x.title === "string" && typeof x.lyrics === "string")
          .slice(0, MAX_CUSTOM)
          .map((x) => ({
            title: x.title.slice(0, 300),
            lyrics: x.lyrics.slice(0, MAX_CUSTOM_TEXT),
            author: "",
            custom: true,
            esv: x.esv === true,
            bg: typeof x.bg === "string" && BG_RE.test(x.bg) ? x.bg : "",
            dim: Math.max(0, Math.min(80, Number(x.dim) || 0)),
            video: typeof x.video === "string" && MEDIA_ID_RE.test(x.video) ? x.video : "",
            muted: x.muted === true,
            deck: Array.isArray(x.deck)
              ? x.deck
                  .filter((d) => d && typeof d.text === "string" && (d.image === "" || MEDIA_ID_RE.test(d.image)))
                  .slice(0, MAX_DECK_SLIDES)
                  .map((d) => ({ text: d.text.slice(0, MAX_DECK_TEXT), image: d.image }))
              : [],
          }))
      : [];
  } catch {
    customs = [];
  }
}

function customLabel(s) {
  if (s.video) return "Video";
  if (s.deck && s.deck.length) return `PowerPoint (${s.deck.length} slides)`;
  return s.esv ? "Bible (ESV)" : "Custom slide";
}

// Every media id still used by a saved slide or by the editor.
function usedMediaIds() {
  const keep = new Set();
  const add = (m) => { if (m) keep.add(m); };
  const scan = (s) => { add(s.video); for (const d of s.deck || []) add(d.image); };
  customs.forEach(scan);
  if (customMedia) { add(customMedia.video); for (const d of customMedia.deck || []) add(d.image); }
  if (song) scan(song);
  add(config && config.theme ? config.theme.blankImage : "");
  return keep;
}

// Removes stored videos/pictures nothing refers to any more. Skipped while an import is in progress.
async function cleanupMedia() {
  if (importing) return;
  try { await pruneMedia(usedMediaIds()); } catch (err) { console.error(err); }
}

// Returns false (and tells the user) if the browser's storage quota is exceeded.
function saveCustoms() {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(customs));
    return true;
  } catch (err) {
    console.error(err);
    setStatus("Could not save: browser storage is full. Use a smaller image or delete some custom slides.");
    return false;
  }
}

function readCustomForm() {
  const lyrics = $("custom-text").value.slice(0, MAX_CUSTOM_TEXT);
  if (importing) { setStatus("Wait for the file to finish importing"); return null; }
  if (!lyrics.trim() && !customBg && !customMedia) { setStatus("Type some text, or choose an image, video or PowerPoint first"); return null; }
  const title = $("custom-title").value.trim().slice(0, 300) || (customMedia && customMedia.name) || "Custom slide";
  const dim = Math.max(0, Math.min(80, parseInt($("custom-dim").value, 10) || 0));
  const m = customMedia || {};
  return {
    title, lyrics, author: "", custom: true, esv: Boolean(editing && editing.esv), bg: customBg, dim,
    video: m.video || "", muted: Boolean(m.video && $("custom-muted").checked), deck: m.deck || [],
  };
}

function renderMediaInfo() {
  const info = $("custom-media-info");
  const m = customMedia;
  info.hidden = !m;
  $("custom-media-clear").hidden = !m;
  $("custom-mute-row").hidden = !(m && m.video);
  if (!m) { info.textContent = ""; return; }
  info.textContent = m.video
    ? `Video: ${m.name}. The lyrics box is used as an optional caption.`
    : `PowerPoint: ${m.name} (${m.deck.length} slides). The lyrics box is ignored.`;
}

function renderBgPreview() {
  const box = $("custom-bg-preview");
  box.style.backgroundImage = customBg ? `url("${customBg}")` : "none";
  box.hidden = !customBg;
  $("custom-bg-clear").hidden = !customBg;
  $("custom-dim-row").hidden = !customBg;
}

function resetCustomForm() {
  editing = null;
  customBg = "";
  $("custom-title").value = "";
  $("custom-text").value = "";
  $("custom-dim").value = "40";
  $("custom-bg-file").value = "";
  $("custom-media-file").value = "";
  $("custom-muted").checked = false;
  customMedia = null;
  $("custom-save").textContent = "Save to library";
  renderBgPreview();
  renderMediaInfo();
  cleanupMedia();
}

function editCustom(s) {
  editing = s;
  customBg = s.bg || "";
  $("custom-title").value = s.title;
  $("custom-text").value = s.lyrics;
  $("custom-dim").value = String(s.dim || 0);
  customMedia = s.video || (s.deck && s.deck.length)
    ? { video: s.video || "", deck: s.deck || [], name: s.video ? "saved video" : "saved presentation" }
    : null;
  $("custom-muted").checked = Boolean(s.muted);
  $("custom-save").textContent = "Update saved slide";
  $("custom-editor").open = true;
  renderBgPreview();
  renderMediaInfo();
  $("custom-editor").scrollIntoView({ block: "nearest" });
}

// Loads an image file, downscales it and re-encodes as JPEG so it fits in localStorage.
async function pickBackground(file) {
  if (!file) return;
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) { setStatus("Choose a JPG, PNG, WebP or GIF image"); return; }
  if (file.size > MAX_IMAGE_FILE) { setStatus("Image is too large (15 MB maximum)"); return; }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = objectUrl;
    await img.decode();
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    if (!BG_RE.test(dataUrl)) throw new Error("Unsupported image");
    customBg = dataUrl;
    renderBgPreview();
    setStatus("Background image added");
  } catch (err) {
    console.error(err);
    setStatus("Could not read that image");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// Stores a chosen video or PowerPoint in IndexedDB and shows it in the editor.
async function pickMedia(file) {
  if (!file) return;
  const name = file.name.toLowerCase();
  const isDeck = /\.(pptx|ppsx|ppt)$/.test(name);
  const isVideo = file.type.startsWith("video/") || /\.(mp4|webm|ogv|mov|m4v)$/.test(name);
  if (!isDeck && !isVideo) { setStatus("Choose a video (MP4, WebM, MOV) or a PowerPoint (.pptx)"); $("custom-media-file").value = ""; return; }

  importing = true;
  const created = []; // ids stored by this import, removed again if it fails
  try {
    if (isVideo) {
      if (file.size > MAX_VIDEO_FILE) throw new ImportError("Video is too large (2 GB maximum)");
      setStatus(`Importing video ${file.name}…`);
      const id = await putMedia(file);
      created.push(id);
      // Make sure this browser can actually play it (e.g. some .mov/.mkv codecs cannot).
      await checkPlayable(id);
      customMedia = { video: id, deck: [], name: file.name };
    } else {
      setStatus(`Reading ${file.name}…`);
      const { slides: deckSlides } = await readPresentation(file);
      const deck = [];
      for (const s of deckSlides.slice(0, MAX_DECK_SLIDES)) {
        let image = "";
        if (s.picture) {
          const jpeg = await imageToJpegBlob(s.picture, 1920).catch(() => null);
          if (jpeg) { image = await putMedia(jpeg); created.push(image); }
        }
        deck.push({ text: s.text.slice(0, MAX_DECK_TEXT), image });
      }
      if (!deck.some((d) => d.text || d.image)) throw new ImportError("No text or pictures were found in this presentation");
      customMedia = { video: "", deck, name: file.name };
    }
    // A new file replaces the previous one; keep the typed text for a video caption only.
    renderMediaInfo();
    setStatus(`Imported ${file.name}`);
  } catch (err) {
    console.error(err);
    for (const id of created) await deleteMedia(id).catch(() => {});
    $("custom-media-file").value = "";
    setStatus(describeImportError(err));
  } finally {
    importing = false;
    cleanupMedia();
  }
}

// ---------- Blank screen image ----------
function renderBlankImageInfo() {
  const has = Boolean(config.theme.blankImage);
  $("blank-image-info").textContent = has ? "A picture is shown when the output is blank." : "None: the output goes black when blank.";
  $("blank-image-clear").hidden = !has;
}

async function pickBlankImage(file) {
  if (!file) return;
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) { setStatus("Choose a JPG, PNG, WebP or GIF image"); return; }
  if (file.size > MAX_IMAGE_FILE) { setStatus("Image is too large (15 MB maximum)"); return; }
  if (importing) { setStatus("Wait for the file to finish importing"); return; }
  importing = true; // blocks media cleanup until the new picture is saved
  try {
    const id = await putMedia(await imageToJpegBlob(file, 1920));
    config.theme.blankImage = id;
    persist();
    renderBlankImageInfo();
    publish();
    setStatus("Blank screen image set");
  } catch (err) {
    console.error(err);
    setStatus(describeImportError(err));
  } finally {
    importing = false;
    $("blank-image-file").value = "";
  }
  cleanupMedia(); // drops the picture it replaced
}

function clearBlankImage() {
  config.theme.blankImage = "";
  persist();
  renderBlankImageInfo();
  publish();
  setStatus("Blank screen image removed");
  cleanupMedia();
}

function describeImportError(err) {
  if (err instanceof ImportError) return err.message;
  if (err && err.name === "QuotaExceededError") return "Not enough browser storage for this file. Delete some saved slides or use a smaller file.";
  return "Could not import that file";
}

async function checkPlayable(id) {
  const url = await getMediaUrl(id);
  await new Promise((resolve, reject) => {
    const v = document.createElement("video");
    const timer = setTimeout(() => reject(new ImportError("Could not read this video. Try an MP4 (H.264) file.")), 15000);
    v.preload = "metadata";
    v.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
    v.onerror = () => { clearTimeout(timer); reject(new ImportError("This browser cannot play that video. Try an MP4 (H.264) file.")); };
    v.src = url;
  });
}

function deleteCustom(s) {
  if (!confirm(`Delete custom slide "${s.title}"?`)) return;
  customs = customs.filter((c) => c !== s);
  saveCustoms();
  if (editing === s) resetCustomForm();
  if (song === s) { song = null; slides = []; index = 0; renderSlideList(); publish(); }
  renderSongList();
  renderSetlist();
  cleanupMedia();
}

function showCustomNow() {
  const s = readCustomForm();
  if (!s) return;
  // Keep the set list position so Next on the last slide continues with the following song.
  selectSong(s, setIndex);
}

// Saves the form to the library and returns the saved slide (null if nothing was saved).
function saveCustom() {
  const s = readCustomForm();
  if (!s) return null;
  const before = customs.slice();
  if (editing) {
    const i = customs.indexOf(editing);
    if (i >= 0) customs[i] = s;
  } else {
    if (customs.length >= MAX_CUSTOM) { setStatus("Custom slide limit reached"); return null; }
    customs.unshift(s);
  }
  if (!saveCustoms()) { customs = before; return null; }
  resetCustomForm(); // also removes stored media that is no longer used
  renderSongList();
  renderSetlist();
  setStatus(`Saved custom slide "${s.title}"`);
  return s;
}

// Saves the form to the library (the set list refers to library entries) and appends it to the set list.
function addCustomToSet() {
  if (setlist.length >= MAX_SETLIST) { setStatus("Set list is full"); return; }
  const s = saveCustom();
  if (!s) return;
  addToSetlist(s);
  setStatus(`Saved "${s.title}" and added it to the set list`);
}

// ---------- ESV Bible ----------
// Turns ESV text with "[16]" verse markers into slides of N verses (shown as "16 text", one verse per row). Only the last slide ends with the reference.
function esvToSlides(text, ref, perSlide) {
  const verses = text.replace(/\r\n?/g, "\n").split(/(?=\[\d+\])/)
    .map((v) => v.replace(/\s+/g, " ").replace(/^\[(\d+)\]\s*/, "$1 ").trim())
    .filter(Boolean);
  const groups = [];
  for (let i = 0; i < verses.length; i += perSlide) groups.push(verses.slice(i, i + perSlide).join("\n"));
  return groups.map((g, i) => (i === groups.length - 1 ? `${g}\n\u2014 ${ref} (ESV)` : g)).join("\n\n");
}

async function fetchEsv() {
  const q = $("esv-ref").value.trim();
  if (!esvKey) { setStatus("Enter your ESV API key in Settings and save it first"); return; }
  if (!q || q.length > 200 || !ESV_REF_RE.test(q)) { setStatus("Enter a valid reference, e.g. John 3:16-18"); return; }
  const perSlide = Math.max(1, Math.min(10, parseInt($("esv-per").value, 10) || 2));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  setStatus("Fetching passage…");
  try {
    const res = await fetch("/api/esv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q, key: esvKey, perSlide }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error || `ESV request failed (${res.status})`;
      if (res.status === 401 || res.status === 403) throw new Error("ESV API key was rejected");
      throw new Error(msg);
    }
    const passages = Array.isArray(data.passages) ? data.passages.filter((p) => typeof p === "string" && p.trim()) : [];
    if (!passages.length) throw new Error("No passage found for that reference");

    const metas = Array.isArray(data.passage_meta) ? data.passage_meta : [];
    const refOf = (i) => String((metas[i] && metas[i].canonical) || data.canonical || q).slice(0, 200);
    const lyrics = passages.map((p, i) => esvToSlides(p, refOf(i), perSlide)).join("\n\n");
    if (lyrics.length > MAX_CUSTOM_TEXT) throw new Error("Passage is too long; request fewer verses");

    esvPending = {
      title: String(data.canonical || q).slice(0, 300),
      lyrics,
      author: "",
      custom: true,
      esv: true,
    };
    // The blank lines only separate slides in the stored text; the preview box shows the passage as continuous rows.
    $("esv-preview").value = lyrics.replace(/\n{2,}/g, "\n");
    for (const id of ["esv-show", "esv-save", "esv-add"]) $(id).disabled = false;
    setStatus(`Fetched ${esvPending.title}`);
  } catch (err) {
    console.error(err);
    setStatus(err.name === "AbortError" ? "ESV request timed out" : err.message);
  } finally {
    clearTimeout(timer);
  }
}

// Saves the pending passage to the library (replacing an earlier ESV save of the same reference).
function storeEsv() {
  if (!esvPending) return null;
  const s = esvPending;
  const i = customs.findIndex((c) => c.esv && c.title === s.title);
  if (i >= 0) customs[i] = s;
  else if (customs.length >= MAX_CUSTOM) { setStatus("Custom slide limit reached"); return null; }
  else customs.unshift(s);
  saveCustoms();
  renderSongList();
  renderSetlist();
  return s;
}

// ---------- Resizable columns ----------
// Column widths are stored as fractions of the window width (library and set list; the preview takes the
// rest), so the layout scales with the window. By default each of the three columns is 1/3.
const LAYOUT_KEY = "presentation-layout-v2";
const MIN_COL = 160;      // narrowest column in px
const HANDLE_W = 6;
const DEFAULT_COLS = { lib: 1 / 3, set: 1 / 3 };
let cols = { ...DEFAULT_COLS };

function totalWidth() { return document.documentElement.clientWidth - 2 * HANDLE_W; }

// Keeps every column at least MIN_COL wide (px in, px out).
function clampPx(px) {
  const total = totalWidth();
  const lib = Math.max(MIN_COL, Math.min(px.lib, total - 2 * MIN_COL));
  const set = Math.max(MIN_COL, Math.min(px.set, total - lib - MIN_COL));
  return { lib, set };
}

// Current column widths in px for the current window size. Does not change `cols`.
function fitCols(c) {
  const total = totalWidth();
  return clampPx({ lib: c.lib * total, set: c.set * total });
}

function pxToCols(px) {
  const total = totalWidth();
  return { lib: px.lib / total, set: px.set / total };
}

function applyCols() {
  const fit = fitCols(cols);
  const app = document.querySelector(".app");
  app.style.setProperty("--col-lib", `${fit.lib}px`);
  app.style.setProperty("--col-set", `${fit.set}px`);
  $("resize-lib").setAttribute("aria-valuenow", String(Math.round(fit.lib)));
  $("resize-set").setAttribute("aria-valuenow", String(Math.round(fit.set)));
  return fit;
}

function saveCols() {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(cols)); } catch { /* layout just isn't remembered */ }
}

function loadCols() {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY));
    if (raw && Number.isFinite(raw.lib) && Number.isFinite(raw.set) && raw.lib > 0 && raw.set > 0 && raw.lib + raw.set < 1) {
      cols = { lib: raw.lib, set: raw.set };
    }
  } catch { /* use defaults */ }
}

function setupResizer(handle, key) {
  let startX = 0;
  let startPx = { lib: 0, set: 0 };

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    startX = e.clientX;
    startPx = fitCols(cols);
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("dragging");
    document.body.classList.add("resizing");
    e.preventDefault();
  });

  handle.addEventListener("pointermove", (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    cols = pxToCols(clampPx({ ...startPx, [key]: startPx[key] + (e.clientX - startX) }));
    applyCols();
  });

  const end = (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    handle.releasePointerCapture(e.pointerId);
    handle.classList.remove("dragging");
    document.body.classList.remove("resizing");
    saveCols();
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);

  handle.addEventListener("dblclick", () => {
    cols = { ...cols, [key]: DEFAULT_COLS[key] };
    cols = pxToCols(fitCols(cols));
    applyCols();
    saveCols();
  });

  // Keyboard: arrow keys resize (Shift = bigger steps), Home resets.
  handle.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 64 : 16;
    const px = fitCols(cols);
    if (e.key === "ArrowLeft") px[key] -= step;
    else if (e.key === "ArrowRight") px[key] += step;
    else if (e.key === "Home") px[key] = DEFAULT_COLS[key] * totalWidth();
    else return;
    e.preventDefault();
    cols = pxToCols(clampPx(px));
    applyCols();
    saveCols();
  });
}

function initLayout() {
  loadCols();
  applyCols();
  setupResizer($("resize-lib"), "lib");
  setupResizer($("resize-set"), "set");
  window.addEventListener("resize", applyCols); // refit without forgetting the preferred sizes
}

// ---------- Settings drawer ----------
function setDrawer(open) {
  $("drawer").hidden = !open;
  $("backdrop").hidden = !open;
  $("menu-btn").setAttribute("aria-expanded", String(open));
  if (open) $("sheet-id").focus();
  else $("menu-btn").focus();
}

// ---------- Events ----------
$("menu-btn").addEventListener("click", () => setDrawer($("drawer").hidden));
$("menu-close").addEventListener("click", () => setDrawer(false));
$("backdrop").addEventListener("click", () => setDrawer(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("drawer").hidden) { e.preventDefault(); setDrawer(false); }
});
$("esv-fetch").addEventListener("click", fetchEsv);
$("esv-ref").addEventListener("keydown", (e) => { if (e.key === "Enter") fetchEsv(); });
$("esv-show").addEventListener("click", () => { if (esvPending) selectSong(esvPending, setIndex); });
$("esv-save").addEventListener("click", () => {
  const s = storeEsv();
  if (s) setStatus(`Saved ${s.title} to the library`);
});
$("esv-add").addEventListener("click", () => {
  const s = storeEsv();
  if (s) { addToSetlist(s); setStatus(`Added ${s.title} to the set list`); }
});
$("custom-media-file").addEventListener("change", (e) => pickMedia(e.target.files[0]));
$("custom-media-clear").addEventListener("click", () => {
  customMedia = null;
  $("custom-media-file").value = "";
  renderMediaInfo();
  cleanupMedia();
});
$("video-play").addEventListener("click", () => sendVideo("toggle"));
$("video-restart").addEventListener("click", () => sendVideo("restart"));
$("custom-bg-file").addEventListener("change", (e) => pickBackground(e.target.files[0]));
$("custom-bg-clear").addEventListener("click", () => { customBg = ""; $("custom-bg-file").value = ""; renderBgPreview(); });
$("custom-show").addEventListener("click", showCustomNow);
$("custom-save").addEventListener("click", saveCustom);
$("custom-add").addEventListener("click", addCustomToSet);
$("custom-clear").addEventListener("click", resetCustomForm);
$("search").addEventListener("input", renderSongList);
$("prev").addEventListener("click", () => go(-1));
$("next").addEventListener("click", () => go(1));
$("blank").addEventListener("click", toggleBlank);
$("live").addEventListener("click", toggleLive);
$("blank-image-file").addEventListener("change", (e) => pickBlankImage(e.target.files[0]));
$("blank-image-clear").addEventListener("click", clearBlankImage);
$("drive-refresh").addEventListener("click", () => refreshDrive(true));
$("drive-search").addEventListener("input", renderDrive);
$("aset-prev").addEventListener("click", () => goTrack(-1));
$("aset-next").addEventListener("click", () => goTrack(1));
$("aset-clear").addEventListener("click", () => {
  if (audioSet.length && confirm("Clear the whole audio set list?")) { audioSet = []; audioIndex = -1; saveAudioSet(); renderAudioSet(); }
});
$("prev-song").addEventListener("click", () => goSong(-1));
$("next-song").addEventListener("click", () => goSong(1));
$("set-clear").addEventListener("click", () => {
  if (setlist.length && confirm("Clear the whole set list?")) {
    setlist = []; setIndex = -1; saveSetlist(); renderSetlist();
  }
});
$("set-export").addEventListener("click", exportSetlist);
$("set-import").addEventListener("click", () => $("set-file").click());
$("set-file").addEventListener("change", (e) => {
  importSetlist(e.target.files[0]);
  e.target.value = "";
});
async function reloadSheet() { readSettingsForm(); await loadSongs(); }
function openOutput() { window.open("output.html", "presentation-output", "popup,width=1280,height=720"); }
$("reload").addEventListener("click", reloadSheet);
$("open-output").addEventListener("click", openOutput);
$("save-settings").addEventListener("click", async () => {
  const prevId = config.sheet.id, prevGid = config.sheet.gid, prevLines = linesPerSlide;
  const hadTitle = config.theme.showTitle;
  const prevFolder = driveFolderId;
  readSettingsForm();
  if (prevFolder !== driveFolderId) { drivePath = []; driveLoaded = ""; $("drive-search").value = ""; }
  persist();
  applyTheme(previewEl, currentTheme());
  if (prevId !== config.sheet.id || prevGid !== config.sheet.gid) await loadSongs();
  if (prevLines !== linesPerSlide || hadTitle !== config.theme.showTitle) rebuildSlides(hadTitle);
  publish();
  setDrawer(false);
  setStatus("Settings saved");
  refreshDrive(false);
});

for (const id of ["bg", "fg", "size", "align", "uppercase", "show-title"]) {
  $(id).addEventListener("input", () => {
    const hadTitle = config.theme.showTitle;
    readSettingsForm();
    if (hadTitle !== config.theme.showTitle) rebuildSlides(hadTitle);
    applyTheme(previewEl, currentTheme());
    publish();
  });
}

// Opens a collapsible box (if given) and puts the cursor in a field.
function focusField(id, detailsId) {
  if (detailsId) $(detailsId).open = true;
  const el = $(id);
  el.focus();
  el.scrollIntoView({ block: "nearest" });
}

document.addEventListener("keydown", (e) => {
  const tag = e.target.tagName;
  const typing = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
  if (!$("drawer").hidden) return; // no shortcuts while the settings drawer is open
  if (e.key === "Escape") {
    if (e.defaultPrevented) return; // this Esc already closed the settings drawer
    // Esc folds the Custom slide, Bible and Google Drive boxes, and leaves the field so the shortcut keys work again.
    for (const id of ["custom-editor", "esv-editor", "drive-panel"]) $(id).open = false;
    if (typing) e.target.blur();
    return;
  }
  if (typing || tag === "AUDIO") return; // the audio player has its own keys
  if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts such as Ctrl+C and Ctrl+L alone
  // Jump straight into a field; preventDefault stops the letter from being typed into it.
  const jump = { a: ["drive-search", "drive-panel"], l: ["search"], c: ["custom-title", "custom-editor"], b: ["esv-ref", "esv-editor"] }[e.key.toLowerCase()];
  if (jump) { e.preventDefault(); focusField(jump[0], jump[1]); return; }
  if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); go(1); }
  else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(-1); }
  else if (e.key === ".") toggleBlank();
  else if (e.key.toLowerCase() === "f") toggleLive();
  else if (e.key.toLowerCase() === "k") sendVideo("toggle");
  else if (e.key.toLowerCase() === "s") sendVideo("restart");
  else if (e.key.toLowerCase() === "r") reloadSheet();
  else if (e.key.toLowerCase() === "o") openOutput();
  else if (e.key.toLowerCase() === "i") setDrawer(true);
  else if (e.key.toLowerCase() === "n") goSong(1);
  else if (e.key.toLowerCase() === "p") goSong(-1);
});

channel.onmessage = (e) => {
  if (e.data && e.data.hello) publish();
};

// ---------- Init ----------
initLayout();
(async function init() {
  try {
    config = await fetchJson("config.json");
  } catch (err) {
    console.error(err);
    setStatus("config.json not found. Serve this folder over http (see README.md)");
    return;
  }
  try {
    const saved = loadSaved();
    if (saved.sheet) Object.assign(config.sheet, saved.sheet);
    if (saved.theme) Object.assign(config.theme, saved.theme);
    if (!MEDIA_ID_RE.test(config.theme.blankImage || "")) config.theme.blankImage = "";
    linesPerSlide = saved.linesPerSlide || 0;
    loadSetlist();
    loadAudioSet();
    loadCustoms();
    esvKey = localStorage.getItem(ESV_KEY_STORAGE) || "";
    driveKey = localStorage.getItem(DRIVE_KEY_STORAGE) || "";
    driveFolderId = saved.drive && extractFolderId(saved.drive.folder) || "";
    fillSettingsForm();
    applyTheme(previewEl, currentTheme());
    await loadSongs();
    publish();
    renderDrive();
    renderAudioSet();
    refreshDrive(false);
  } catch (err) {
    console.error(err);
    setStatus(`Startup error: ${err.message}. See the browser console (F12).`);
  }
})();
