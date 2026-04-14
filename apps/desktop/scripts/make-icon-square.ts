import sharp from "sharp";
import { join } from "path";

const input = join(import.meta.dir, "../src-tauri/icons/icon.png");
const output = join(import.meta.dir, "../src-tauri/icons/icon-square.png");

const WHITE_THRESHOLD = 250;

/** Índice lineal a partir de x,y */
const idx = (x: number, y: number, w: number, ch: number) => (y * w + x) * ch;

const img = await sharp(input).ensureAlpha();
const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
const { width = 0, height = 0, channels } = info;

/** Es blanco según umbral */
const isWhite = (i: number) =>
  data[i] >= WHITE_THRESHOLD && data[i + 1] >= WHITE_THRESHOLD && data[i + 2] >= WHITE_THRESHOLD;

// Flood fill desde los bordes: solo quitamos blanco conectado al fondo
const isBg = new Uint8Array((width * height) / 8 + 1); // bitmap
const setBg = (x: number, y: number) => {
  const p = y * width + x;
  isBg[p >> 3] |= 1 << (p & 7);
};
const getBg = (x: number, y: number) => !!(isBg[(y * width + x) >> 3] & (1 << ((y * width + x) & 7)));

const queue: [number, number][] = [];
// Semillas: píxeles blancos en los 4 bordes
for (let x = 0; x < width; x++) {
  if (isWhite(idx(x, 0, width, channels))) queue.push([x, 0]);
  if (height > 1 && isWhite(idx(x, height - 1, width, channels))) queue.push([x, height - 1]);
}
for (let y = 1; y < height - 1; y++) {
  if (isWhite(idx(0, y, width, channels))) queue.push([0, y]);
  if (width > 1 && isWhite(idx(width - 1, y, width, channels))) queue.push([width - 1, y]);
}

const dx = [0, 1, 0, -1];
const dy = [-1, 0, 1, 0];
while (queue.length) {
  const [x, y] = queue.shift()!;
  if (x < 0 || x >= width || y < 0 || y >= height) continue;
  if (getBg(x, y)) continue;
  const i = idx(x, y, width, channels);
  if (!isWhite(i)) continue;
  setBg(x, y);
  for (let d = 0; d < 4; d++) queue.push([x + dx[d], y + dy[d]]);
}

// Aplicar transparencia solo al fondo detectado
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) if (getBg(x, y)) data[idx(x, y, width, channels) + 3] = 0;

const noBg = await sharp(data, {
  raw: { width, height, channels },
})
  .png()
  .toBuffer();

const size = Math.max(width, height);
const left = Math.floor((size - width) / 2);
const top = Math.floor((size - height) / 2);

await sharp({
  create: {
    width: size,
    height: size,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([{ input: noBg, left, top }])
  .png()
  .toFile(output);

console.log(`Creado icon-square.png ${size}x${size} (fondo blanco → transparente)`);
