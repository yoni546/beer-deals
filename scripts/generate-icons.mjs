/**
 * Generates the PWA icons.
 *
 * Writes PNGs directly — a deflate stream plus four chunks — rather than
 * pulling in an image library. The artwork is a few filled shapes, and adding a
 * native dependency to draw a rectangle would cost more than it is worth.
 *
 * The mark is a beer glass: our own drawing, no brand anywhere near it.
 *
 * Run: npm run icons
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const BASE = [0x17, 0x13, 0x0b]; // page background
const AMBER = [0xe0, 0xa5, 0x2b]; // the beer
const FOAM = [0xfa, 0xf6, 0xee]; // the head, and the glass outline

// --- PNG ------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** pixels: Uint8Array of size * size * 4, RGBA. */
function encodePng(size, pixels) {
  const stride = size * 4;
  // One filter byte (0 = none) per scanline, as the PNG spec requires.
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Drawing --------------------------------------------------------------

function canvas(size, background) {
  const pixels = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    pixels[i * 4] = background[0];
    pixels[i * 4 + 1] = background[1];
    pixels[i * 4 + 2] = background[2];
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

function fillRect(pixels, size, x0, y0, x1, y1, colour, radius = 0) {
  const left = Math.max(0, Math.round(x0));
  const right = Math.min(size, Math.round(x1));
  const top = Math.max(0, Math.round(y0));
  const bottom = Math.min(size, Math.round(y1));

  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      if (radius > 0) {
        // Knock the corners off by testing against the corner circle.
        const dx = Math.max(left + radius - x, x - (right - radius), 0);
        const dy = Math.max(top + radius - y, y - (bottom - radius), 0);
        if (dx * dx + dy * dy > radius * radius) continue;
      }
      const i = (y * size + x) * 4;
      pixels[i] = colour[0];
      pixels[i + 1] = colour[1];
      pixels[i + 2] = colour[2];
      pixels[i + 3] = 255;
    }
  }
}

/**
 * @param padding fraction of the canvas kept clear around the mark. Maskable
 *   icons are cropped to a circle by Android, so they need a wide safe zone.
 */
function drawGlass(size, padding) {
  const pixels = canvas(size, BASE);
  const u = size * (1 - padding * 2); // the drawing area
  const x = size * padding;
  const y = size * padding;

  const glassLeft = x + u * 0.22;
  const glassRight = x + u * 0.72;
  const glassTop = y + u * 0.1;
  const glassBottom = y + u * 0.92;
  const r = u * 0.06;

  // Glass body.
  fillRect(pixels, size, glassLeft, glassTop, glassRight, glassBottom, FOAM, r);
  // The beer inside it.
  fillRect(
    pixels,
    size,
    glassLeft + u * 0.05,
    glassTop + u * 0.22,
    glassRight - u * 0.05,
    glassBottom - u * 0.05,
    AMBER,
    r * 0.6,
  );
  // Handle.
  fillRect(pixels, size, glassRight, glassTop + u * 0.25, glassRight + u * 0.16, glassBottom - u * 0.28, FOAM, r);
  fillRect(
    pixels,
    size,
    glassRight + u * 0.04,
    glassTop + u * 0.33,
    glassRight + u * 0.12,
    glassBottom - u * 0.36,
    BASE,
    r * 0.5,
  );

  return pixels;
}

// --- Output ---------------------------------------------------------------

mkdirSync(OUT, { recursive: true });

const files = [
  ["icon-192.png", 192, 0.1],
  ["icon-512.png", 512, 0.1],
  ["icon-180.png", 180, 0.08], // apple-touch-icon: iOS adds its own rounding
  ["badge-96.png", 96, 0.12], // the small monochrome-ish badge in the tray
  ["maskable-512.png", 512, 0.2], // wide safe zone; Android crops to a circle
];

for (const [name, size, padding] of files) {
  writeFileSync(join(OUT, name), encodePng(size, drawGlass(size, padding)));
  console.log(`wrote icons/${name} (${size}x${size})`);
}
