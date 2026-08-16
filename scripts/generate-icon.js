'use strict';
/**
 * Generate build/icon.png (512x512) with no external dependencies.
 * A dark tile with a blue rounded square and a white "share" arrow.
 * Also emits the tray icons: build/tray.png (32x32 colored, Windows/Linux)
 * and build/trayTemplate.png (+@2x) (black-on-transparent, macOS menu bar).
 * Run: node scripts/generate-icon.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;

// Colors (RGB)
const BG = [20, 22, 31];        // dark
const ACCENT = [79, 140, 255];  // blue
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

function inRoundedSquare(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y, y1 - r));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const sign = (x1, y1, x2, y2, x3, y3) =>
    (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = sign(px, py, ax, ay, bx, by);
  const d2 = sign(px, py, bx, by, cx, cy);
  const d3 = sign(px, py, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function inRect(x, y, x0, y0, x1, y1) {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function pixelColor(x, y) {
  // Blue rounded square
  if (inRoundedSquare(x, y, 96, 96, 416, 416, 56)) {
    // White share arrow inside
    // Arrowhead triangle (apex up)
    if (inTriangle(x, y, 256, 150, 196, 232, 316, 232)) return WHITE;
    // Stem
    if (inRect(x, y, 240, 232, 272, 330)) return WHITE;
    // Base bar
    if (inRect(x, y, 196, 330, 316, 352)) return WHITE;
    return ACCENT;
  }
  return BG;
}

// --- PNG encoding ---
function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function buildPng() {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Raw scanlines: each row prefixed with filter byte 0.
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 3));
  let o = 0;
  for (let y = 0; y < SIZE; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = pixelColor(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }

  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- RGBA PNG encoding (for the tray icons) ---
function buildPngRgba(size, pixelRgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: truecolor RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const raw = Buffer.alloc(size * (1 + size * 4));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelRgba(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = a;
    }
  }

  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * The share glyph as normalized (0..1) geometry: a rounded square with a white
 * share arrow. Returns 'bg' | 'square' | 'arrow' so each caller maps to its
 * own colors.
 */
function glyphAt(nx, ny) {
  const x0 = 96 / SIZE, x1 = 416 / SIZE, y0 = 96 / SIZE, y1 = 416 / SIZE, r = 56 / SIZE;
  if (!inRoundedSquare(nx, ny, x0, y0, x1, y1, r)) return 'bg';
  if (inTriangle(nx, ny, 0.5, 150 / SIZE, 196 / SIZE, 232 / SIZE, 316 / SIZE, 232 / SIZE)) {
    return 'arrow';
  }
  if (inRect(nx, ny, 240 / SIZE, 232 / SIZE, 272 / SIZE, 330 / SIZE)) return 'arrow';
  if (inRect(nx, ny, 196 / SIZE, 330 / SIZE, 316 / SIZE, 352 / SIZE)) return 'arrow';
  return 'square';
}

/** A tray icon pixel: transparent background, glyph in the given colors. */
function trayPixel(x, y, size, squareColor, arrowColor) {
  const g = glyphAt(x / size, y / size);
  if (g === 'bg') return [0, 0, 0, 0];
  const c = g === 'arrow' ? arrowColor : squareColor;
  return [c[0], c[1], c[2], 255];
}

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'icon.png');
fs.writeFileSync(out, buildPng());
console.log(`Wrote ${out} (${fs.statSync(out).size} bytes)`);

// Tray icons.
fs.writeFileSync(
  path.join(outDir, 'tray.png'),
  buildPngRgba(32, (x, y) => trayPixel(x, y, 32, ACCENT, WHITE))
);
fs.writeFileSync(
  path.join(outDir, 'trayTemplate.png'),
  buildPngRgba(16, (x, y) => trayPixel(x, y, 16, BLACK, BLACK))
);
fs.writeFileSync(
  path.join(outDir, 'trayTemplate@2x.png'),
  buildPngRgba(32, (x, y) => trayPixel(x, y, 32, BLACK, BLACK))
);
console.log(`Wrote tray icons in ${outDir}`);
