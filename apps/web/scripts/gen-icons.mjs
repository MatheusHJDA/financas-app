// Gera os PNGs dos icones (um "F" branco sobre fundo solido) sem dependencias extras.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [0x0f, 0x76, 0x6e];
const FG = [0xff, 0xff, 0xff];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// scale: fracao do lado ocupada pelo "F" (menor no maskable, que tem zona segura de 80%).
function png(size, scale) {
  const unit = (size * scale) / 5; // "F" desenhado numa grade 5x7
  const x0 = (size - unit * 5) / 2;
  const y0 = (size - unit * 7) / 2;
  const cells = [
    [0, 0, 5, 1],
    [0, 1, 1, 6],
    [1, 3, 3, 1],
  ];
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const inF = cells.some(
        ([cx, cy, w, h]) =>
          x >= x0 + cx * unit &&
          x < x0 + (cx + w) * unit &&
          y >= y0 + cy * unit &&
          y < y0 + (cy + h) * unit,
      );
      row.set(inF ? FG : BG, 1 + x * 3);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", png(192, 0.6));
writeFileSync("public/icons/icon-512.png", png(512, 0.6));
writeFileSync("public/icons/icon-512-maskable.png", png(512, 0.42));
console.log("icones gerados em public/icons");
