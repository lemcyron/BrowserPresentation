// Shared rendering used by the operator preview and the output window.
// All text is written with textContent, never innerHTML, to avoid injection from sheet data.
import { getMediaUrl, MEDIA_ID_RE } from "./media.js";

export const CHANNEL_NAME = "presentation-channel";

export function applyTheme(screen, theme) {
  screen.style.setProperty("--screen-bg", theme.background);
  screen.style.setProperty("--screen-fg", theme.color);
  screen.style.setProperty("--screen-font", theme.fontFamily);
  screen.style.setProperty("--screen-size", String(theme.fontSize));
  screen.style.setProperty("--screen-align", theme.align);
  screen.style.setProperty("--screen-case", theme.uppercase ? "uppercase" : "none");
}

const BG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

// ---------- video / stored picture layer ----------
export function getVideo(screen) {
  return screen.querySelector(":scope > .media > video");
}

// cmd: "play" | "pause" | "restart"
export function videoCommand(screen, cmd) {
  const v = getVideo(screen);
  if (!v) return;
  if (cmd === "pause") v.pause();
  else if (cmd === "play") v.play().catch(() => {});
  else if (cmd === "restart") { v.currentTime = 0; v.play().catch(() => {}); }
}

// Called after a click/key press, when sound was blocked by the browser. Does nothing otherwise.
export function unlockSound(screen) {
  const v = getVideo(screen);
  if (!v || !v._soundBlocked) return;
  v._soundBlocked = false;
  v.muted = Boolean(v._wantMuted) || Boolean(v._forceMute);
  if (!v._blankPaused) v.play().catch(() => {});
}

function startVideo(v, opts) {
  v.play().catch(() => {
    if (v.muted) return;
    // Browsers refuse sound until the page has had a click or key press: play silently and ask for one.
    v._soundBlocked = true;
    v.muted = true;
    v.play().catch(() => {});
    if (opts.onSoundBlocked) opts.onSoundBlocked();
  });
}

async function syncMedia(screen, state, opts, token) {
  let layer = screen.querySelector(":scope > .media");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "media";
    screen.prepend(layer);
  }
  const video = MEDIA_ID_RE.test(state.video || "") ? state.video : "";
  const image = !video && MEDIA_ID_RE.test(state.image || "") ? state.image : "";
  const key = video || image;

  // Only rebuild when the media changes, so theme changes and Blank do not restart a playing video.
  if ((layer.firstElementChild ? layer.firstElementChild.dataset.mediaId : "") !== key) {
    layer.replaceChildren();
    if (!key) return;
    let url = "";
    try { url = await getMediaUrl(key); } catch (err) { console.error(err); }
    if (token !== screen._renderToken || !url) return; // a newer slide took over, or the file is missing
    let el;
    if (video) {
      el = document.createElement("video");
      el.playsInline = true;
      el.preload = "auto";
      el._forceMute = Boolean(opts.mute);
      el.muted = el._forceMute || Boolean(state.muted);
      el._wantMuted = Boolean(state.muted);
      el._blankPaused = Boolean(state.blank);
      el.src = url;
      el.dataset.mediaId = key;
      layer.append(el);
      if (!state.blank && !state.paused) startVideo(el, opts);
    } else {
      el = document.createElement("img");
      el.alt = "";
      el.src = url;
      el.dataset.mediaId = key;
      layer.append(el);
    }
    return;
  }

  const v = getVideo(screen);
  if (!v) return;
  v._wantMuted = Boolean(state.muted);
  v._forceMute = Boolean(opts.mute);
  v.muted = v._wantMuted || v._forceMute || Boolean(v._soundBlocked);
  if (state.blank) {
    if (!v.paused) { v.pause(); v._blankPaused = true; }
  } else if (v._blankPaused) {
    v._blankPaused = false;
    // Same path as a fresh start: if the browser blocks sound, play silently and show the "click once" hint.
    if (!state.paused) startVideo(v, opts);
  }
}

// Picture shown instead of a black screen while the output is blank (set in Settings). Only validated ids are used.
async function syncBlankImage(screen, theme) {
  let img = screen.querySelector(":scope > .blank-img");
  const id = theme && MEDIA_ID_RE.test(theme.blankImage || "") ? theme.blankImage : "";
  if (!id) { if (img) img.remove(); return; }
  if (!img) {
    img = document.createElement("img");
    img.className = "blank-img";
    img.alt = "";
    screen.append(img);
  }
  if (img.dataset.mediaId === id) return;
  img.dataset.mediaId = id;
  let url = "";
  try { url = await getMediaUrl(id); } catch (err) { console.error(err); }
  if (img.dataset.mediaId !== id) return; // a newer image was chosen meanwhile
  if (url) img.src = url; else img.remove();
}

async function syncBackground(screen, state, theme, token) {
  if (state.blank) {
    screen.style.backgroundImage = "none";
    return;
  }
  // 1. Explicit slide background (from custom slide)
  if (state.bg && BG_RE.test(state.bg)) {
    const d = Math.max(0, Math.min(80, Number(state.dim) || 0)) / 100;
    screen.style.backgroundImage = `linear-gradient(rgba(0,0,0,${d}),rgba(0,0,0,${d})), url("${state.bg}")`;
    return;
  }
  // 2. Global background image for all lyric slides (unless playing a video or image slide deck)
  const bgId = theme && MEDIA_ID_RE.test(theme.backgroundImage || "") ? theme.backgroundImage : "";
  if (bgId && !state.video && !state.image) {
    let url = "";
    try { url = await getMediaUrl(bgId); } catch (err) { console.error(err); }
    if (token !== screen._renderToken) return;
    if (url) {
      const d = Math.max(0, Math.min(80, Number(theme.backgroundDim != null ? theme.backgroundDim : 40))) / 100;
      screen.style.backgroundImage = `linear-gradient(rgba(0,0,0,${d}),rgba(0,0,0,${d})), url("${url}")`;
      return;
    }
  }
  screen.style.backgroundImage = "none";
}

// opts: { mute: true } keeps the video silent (the output window is always silent; the operator preview
//       plays the sound, because only a window the operator has clicked is allowed to make sound);
//       { onSoundBlocked } is called when the browser blocks sound.
export function renderSlide(screen, state, theme, opts = {}) {
  const token = (screen._renderToken = (screen._renderToken || 0) + 1);
  syncMedia(screen, state, opts, token).catch((err) => console.error(err));
  syncBlankImage(screen, theme).catch((err) => console.error(err));
  syncBackground(screen, state, theme, token).catch((err) => console.error(err));
  const inner = screen.querySelector(".inner");
  inner.replaceChildren();
  inner.classList.toggle("title-slide", Boolean(state.isTitle));
  if (state.isTitle) {
    const t = document.createElement("span");
    t.className = "song-title";
    t.textContent = state.title;
    inner.append(t);
    if (state.author) {
      const a = document.createElement("span");
      a.className = "song-author";
      a.textContent = state.author;
      inner.append(a);
    }
  } else {
    inner.append(document.createTextNode(state.text || ""));
  }
  screen.classList.toggle("blank", Boolean(state.blank));
}
