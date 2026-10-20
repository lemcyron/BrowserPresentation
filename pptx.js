// Reads a PowerPoint (.pptx / .ppsx) file in the browser: slide order, text, and the largest picture per slide.
// A .pptx is a zip of XML parts, so this includes a small zip reader built on the browser's DecompressionStream.
// Not supported: shapes, charts, animations, embedded video and legacy .ppt files.
import { ImportError } from "./media.js";

const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const MAX_FILE = 200 * 1024 * 1024;      // whole .pptx
const MAX_ENTRIES = 5000;
const MAX_XML = 5 * 1024 * 1024;         // per XML part, after decompression
const MAX_PICTURE = 40 * 1024 * 1024;    // per picture, after decompression
const MAX_SLIDES = 300;
const PICTURE_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };

// ---------- zip reading ----------
async function readZipDirectory(file) {
  const tailLen = Math.min(file.size, 22 + 65535);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ImportError("This is not a valid .pptx file");

  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ImportError("Zip64 files are not supported");
  if (count > MAX_ENTRIES || cdOffset + cdSize > file.size) throw new ImportError("This .pptx file looks damaged");

  const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const decoder = new TextDecoder();
  const entries = new Map();
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== 0x02014b50) throw new ImportError("This .pptx file looks damaged");
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const name = decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    entries.set(name, {
      encrypted: (cd.getUint16(p + 8, true) & 1) !== 0,
      method: cd.getUint16(p + 10, true),
      csize: cd.getUint32(p + 20, true),
      usize: cd.getUint32(p + 24, true),
      offset: cd.getUint32(p + 42, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Returns the entry's bytes, refusing anything larger than maxSize (checked while decompressing).
async function readEntry(file, entry, maxSize) {
  if (entry.encrypted) throw new ImportError("Password-protected presentations are not supported");
  if (entry.usize > maxSize) throw new ImportError("A part of this presentation is too large");

  const lh = new DataView(await file.slice(entry.offset, entry.offset + 30).arrayBuffer());
  if (lh.getUint32(0, true) !== 0x04034b50) throw new ImportError("This .pptx file looks damaged");
  const start = entry.offset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
  const raw = file.slice(start, start + entry.csize);

  if (entry.method === 0) return new Uint8Array(await raw.arrayBuffer());
  if (entry.method !== 8) throw new ImportError("Unsupported compression in this .pptx file");
  if (typeof DecompressionStream === "undefined") throw new ImportError("This browser cannot read .pptx files. Use a current Chrome, Edge, Firefox or Safari.");

  const reader = raw.stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxSize) { await reader.cancel(); throw new ImportError("A part of this presentation is too large"); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

// ---------- paths and XML ----------
function resolvePath(baseDir, target) {
  const parts = target.startsWith("/") ? [] : baseDir.split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

function dirOf(path) { return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""; }
function ext(path) { return path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : ""; }

function parseXml(bytes) {
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new ImportError("This .pptx file contains unreadable XML");
  return doc;
}

async function readXml(file, entries, path) {
  const entry = entries.get(path);
  return entry ? parseXml(await readEntry(file, entry, MAX_XML)) : null;
}

// relationship id -> { target (resolved zip path), type }
async function readRels(file, entries, partPath) {
  const relsPath = `${dirOf(partPath)}/_rels/${partPath.slice(partPath.lastIndexOf("/") + 1)}.rels`;
  const doc = await readXml(file, entries, relsPath);
  const map = new Map();
  if (!doc) return map;
  for (const rel of doc.getElementsByTagName("Relationship")) {
    if (rel.getAttribute("TargetMode") === "External") continue;
    map.set(rel.getAttribute("Id"), {
      target: resolvePath(dirOf(partPath), rel.getAttribute("Target") || ""),
      type: rel.getAttribute("Type") || "",
    });
  }
  return map;
}

function paragraphText(p) {
  let out = "";
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue;
      if (child.localName === "t") out += child.textContent;
      else if (child.localName === "br") out += "\n";
      else if (child.localName !== "pPr") walk(child);
    }
  };
  walk(p);
  return out.trim();
}

// Slide number, date and footer placeholders are not slide content.
function isFurniture(p) {
  for (let n = p.parentNode; n; n = n.parentNode) {
    if (n.localName === "sp") {
      const ph = n.getElementsByTagNameNS("*", "ph")[0];
      const type = ph ? ph.getAttribute("type") : "";
      return type === "sldNum" || type === "dt" || type === "ftr";
    }
  }
  return false;
}

function slideText(doc) {
  const lines = [];
  for (const p of doc.getElementsByTagNameNS(A_NS, "p")) {
    if (isFurniture(p)) continue;
    const text = paragraphText(p);
    if (text) lines.push(text);
  }
  return lines.join("\n");
}

// ---------- public API ----------
// Returns { slides: [{ text, picture: Blob|null }] }. Throws an Error with a user-readable message.
export async function readPresentation(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".ppt")) throw new ImportError("Old .ppt files are not supported. In PowerPoint use Save As and choose .pptx.");
  if (!/\.(pptx|ppsx)$/.test(name)) throw new ImportError("Choose a .pptx or .ppsx file");
  if (file.size > MAX_FILE) throw new ImportError("This presentation is too large (200 MB maximum)");

  const entries = await readZipDirectory(file);
  const presentation = await readXml(file, entries, "ppt/presentation.xml");
  if (!presentation) throw new ImportError("This does not look like a PowerPoint presentation");
  const presRels = await readRels(file, entries, "ppt/presentation.xml");

  const slidePaths = [];
  for (const id of presentation.getElementsByTagNameNS("*", "sldId")) {
    const rel = presRels.get(id.getAttributeNS(R_NS, "id"));
    if (rel && entries.has(rel.target)) slidePaths.push(rel.target);
  }
  if (!slidePaths.length) throw new ImportError("No slides were found in this presentation");
  if (slidePaths.length > MAX_SLIDES) throw new ImportError(`Too many slides (${MAX_SLIDES} maximum)`);

  const slides = [];
  for (const path of slidePaths) {
    const doc = await readXml(file, entries, path);
    const rels = await readRels(file, entries, path);

    // Pictures actually used on the slide; keep the largest one.
    let best = null;
    for (const blip of doc.getElementsByTagNameNS(A_NS, "blip")) {
      const rel = rels.get(blip.getAttributeNS(R_NS, "embed"));
      const entry = rel && entries.get(rel.target);
      const type = rel && PICTURE_TYPES[ext(rel.target)];
      if (entry && type && entry.usize <= MAX_PICTURE && (!best || entry.usize > best.entry.usize)) best = { entry, type };
    }
    const picture = best ? new Blob([await readEntry(file, best.entry, MAX_PICTURE)], { type: best.type }) : null;
    slides.push({ text: slideText(doc), picture });
  }
  return { slides };
}
