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

// Called after a click/key press on the output window, when sound was blocked by the browser.
export function unlockSound(screen) {
  const v = getVideo(screen);
  if (!v) return;
  v._soundBlocked = false;
  v.muted = Boolean(v._wantMuted);
  v.play().catch(() => {});
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
      el.muted = Boolean(opts.preview) || Boolean(state.muted);
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
  if (!opts.preview) v.muted = v._wantMuted || Boolean(v._soundBlocked);
  if (state.blank) {
    if (!v.paused) { v.pause(); v._blankPaused = true; }
  } else if (v._blankPaused) {
    v._blankPaused = false;
    v.play().catch(() => {});
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

// opts: { preview: true } for the operator preview (video is always silent there);
//       { onSoundBlocked } is called on the output window when the browser blocks sound.
export function renderSlide(screen, state, theme, opts = {}) {
  const token = (screen._renderToken = (screen._renderToken || 0) + 1);
  syncMedia(screen, state, opts, token).catch((err) => console.error(err));
  syncBlankImage(screen, theme).catch((err) => console.error(err));
  // Only validated image data URLs are accepted as a background.
  if (state.bg && BG_RE.test(state.bg)) {
    const d = Math.max(0, Math.min(80, Number(state.dim) || 0)) / 100;
    screen.style.backgroundImage = `linear-gradient(rgba(0,0,0,${d}),rgba(0,0,0,${d})), url("${state.bg}")`;
  } else {
    screen.style.backgroundImage = "none";
  }
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
