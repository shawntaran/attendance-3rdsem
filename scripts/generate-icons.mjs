// Draws the app icons with no dependencies and writes them to public/.
// Run with: npm run icons
//
// The icon is a 2x2 block of timetable cells (two green, one red, one amber)
// on the header teal. The artwork stays inside the middle 60%, so the same
// files work as "maskable" icons and as the iOS home screen icon.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const TEAL = [0x0b, 0x5e, 0x66];
const CELLS = [
  { col: 0, row: 0, color: [0xd2, 0xef, 0xd8] }, // can skip
  { col: 1, row: 0, color: [0xf1, 0xa5, 0x9c] }, // attend
  { col: 0, row: 1, color: [0xff, 0xd1, 0x66] }, // today / skipped
  { col: 1, row: 1, color: [0xd2, 0xef, 0xd8] }, // can skip
];

// Layout in units of the icon size.
const INSET = 0.2;
const GAP = 0.05;
const CELL = (1 - 2 * INSET - GAP) / 2;
const RADIUS = 0.055;
const SS = 4; // supersampling per axis

function inRoundedRect(x, y, x0, y0, size, r) {
  if (x < x0 || y < y0 || x > x0 + size || y > y0 + size) return false;
  const cx = Math.min(Math.max(x, x0 + r), x0 + size - r);
  const cy = Math.min(Math.max(y, y0 + r), y0 + size - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function colorAt(x, y) {
  for (const cell of CELLS) {
    const x0 = INSET + cell.col * (CELL + GAP);
    const y0 = INSET + cell.row * (CELL + GAP);
    if (inRoundedRect(x, y, x0, y0, CELL, RADIUS)) return cell.color;
  }
  return TEAL;
}

function render(size) {
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let py = 0; py < size; py++) {
    raw[py * stride] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = colorAt((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const o = py * stride + 1 + px * 3;
      raw[o] = Math.round(r / (SS * SS));
      raw[o + 1] = Math.round(g / (SS * SS));
      raw[o + 2] = Math.round(b / (SS * SS));
    }
  }
  return raw;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(render(size), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  writeFileSync(join(OUT, name), png(size));
  console.log(`public/${name} (${size}x${size})`);
}
