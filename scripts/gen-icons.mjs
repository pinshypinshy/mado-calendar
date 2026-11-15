// アイコンの PNG を作る（依存ライブラリなし）。`node scripts/gen-icons.mjs` で public/ に書き出す。
// 図柄：青い角丸の背景に、白いカレンダーの形。

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const WHITE = [255, 255, 255, 255];

/**
 * 図柄：角丸の背景に、白いカレンダーの形。背景は全面を塗る（iOS が角を丸めるため、透明にしない）
 * @param base 背景の色
 * @param dark カレンダーの上部（リング・見出し）の色
 */
function makePixel(base, dark) {
  return (x, y) => {
    const inBody = x > 0.2 && x < 0.8 && y > 0.25 && y < 0.8;
    const inHeader = x > 0.2 && x < 0.8 && y > 0.25 && y < 0.38;
    const rings = (Math.abs(x - 0.35) < 0.03 || Math.abs(x - 0.65) < 0.03) && y > 0.18 && y < 0.3;
    const cellX = Math.floor((x - 0.24) / 0.105);
    const cellY = Math.floor((y - 0.43) / 0.11);
    const inCell =
      x > 0.24 && x < 0.76 && y > 0.43 && y < 0.76 &&
      (x - 0.24) % 0.105 < 0.075 && (y - 0.43) % 0.11 < 0.08 && cellX < 5 && cellY < 3;
    if (rings || inHeader) return dark;
    if (inCell) return cellX === 2 && cellY === 1 ? [229, 115, 115, 255] : [225, 240, 250, 255];
    if (inBody) return WHITE;
    return base;
  };
}

// 閲覧画面（青）と管理画面（濃い灰色）。ホーム画面で見分けられるよう色を変える
const variants = [
  { prefix: '', pixel: makePixel([3, 155, 229, 255], [2, 119, 189, 255]) },
  { prefix: 'admin-', pixel: makePixel([69, 90, 100, 255], [38, 50, 56, 255]) },
];

for (const { prefix, pixel } of variants) {
  for (const [name, size] of [
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['apple-touch-icon.png', 180],
  ]) {
    writeFileSync(new URL(`../public/${prefix}${name}`, import.meta.url), png(size, pixel));
  }
}
console.log('icons written');
