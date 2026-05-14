/**
 * Genera BMP 24 bits para el instalador NSIS (MUI): cabecera, lateral con logo centrado, desinstalador.
 * NSIS no inserta el icono de la app solo; hay que dibujarlo en el bitmap del lateral.
 *
 * Ejecutar desde apps/desktop: `bun run nsis-branding`
 */
import { join } from "path";
import sharp from "sharp";

const OUT_DIR = join(import.meta.dir, "../src-tauri/windows/nsis");

const ICON_CANDIDATES = [
  join(import.meta.dir, "../src-tauri/icons/128x128@2x.png"),
  join(import.meta.dir, "../src-tauri/icons/128x128.png"),
  join(import.meta.dir, "../src-tauri/icons/icon.png"),
];

/** Color de marca (RGB) — mismo tono oscuro que la UI SaveCloud */
const HEADER_RGB: [number, number, number] = [18, 18, 28];
const SIDEBAR_RGB: [number, number, number] = [14, 20, 40];

async function resolveLogoPath(): Promise<string> {
  for (const p of ICON_CANDIDATES) {
    if (await Bun.file(p).exists()) return p;
  }
  throw new Error("No se encontró PNG de icono (128x128@2x, 128x128 o icon.png) en src-tauri/icons");
}

function rgbObj(rgb: [number, number, number]) {
  return { r: rgb[0], g: rgb[1], b: rgb[2] };
}

/** Convierte salida raw de sharp (RGB o RGBA) a RGB 24 interleaved. */
function rawToRgbTopDown(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  bg: { r: number; g: number; b: number }
): Buffer {
  const n = width * height;
  const out = Buffer.alloc(n * 3);
  if (channels === 3) {
    data.copy(out, 0, 0, n * 3);
    return out;
  }
  if (channels !== 4) {
    throw new Error(`Canales no soportados: ${channels}`);
  }
  for (let i = 0; i < n; i++) {
    const s = i * 4;
    const d = i * 3;
    const a = data[s + 3] / 255;
    const ia = 1 - a;
    out[d] = Math.round(data[s] * a + bg.r * ia);
    out[d + 1] = Math.round(data[s + 1] * a + bg.g * ia);
    out[d + 2] = Math.round(data[s + 2] * a + bg.b * ia);
  }
  return out;
}

/** BMP 24 bits, DIB con altura negativa (orden top-down, compatible con NSIS/MUI). */
function packBmp24TopDown(width: number, height: number, rgbTopDown: Buffer): Buffer {
  if (rgbTopDown.length !== width * height * 3) {
    throw new Error(`RGB buffer size mismatch: expected ${width * height * 3}, got ${rgbTopDown.length}`);
  }
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelDataSize = rowSize * height;
  const fileSize = 14 + 40 + pixelDataSize;

  const header = Buffer.alloc(14);
  header.write("BM", 0);
  header.writeUInt32LE(fileSize, 2);
  header.writeUInt32LE(0, 6);
  header.writeUInt32LE(54, 10);

  const dib = Buffer.alloc(40);
  dib.writeUInt32LE(40, 0);
  dib.writeInt32LE(width, 4);
  dib.writeInt32LE(-height, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(24, 14);
  dib.writeUInt32LE(0, 16);
  dib.writeUInt32LE(pixelDataSize, 20);

  const pixels = Buffer.alloc(pixelDataSize);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 3;
      const d = y * rowSize + x * 3;
      pixels[d] = rgbTopDown[s + 2];
      pixels[d + 1] = rgbTopDown[s + 1];
      pixels[d + 2] = rgbTopDown[s];
    }
    for (let x = width * 3; x < rowSize; x++) {
      pixels[y * rowSize + x] = 0;
    }
  }

  return Buffer.concat([header, dib, pixels]);
}

/** Lateral bienvenida / final: icono centrado sobre fondo de marca (164×314). */
async function writeSidebarWithLogo(outPath: string, logoPath: string) {
  const W = 164;
  const H = 314;
  const maxLogo = 120;
  const bg = rgbObj(SIDEBAR_RGB);

  const logoBuf = await sharp(logoPath).resize(maxLogo, maxLogo, { fit: "inside" }).ensureAlpha().png().toBuffer();

  const meta = await sharp(logoBuf).metadata();
  const lw = meta.width ?? maxLogo;
  const lh = meta.height ?? maxLogo;
  const left = Math.round((W - lw) / 2);
  const top = Math.round((H - lh) / 2);

  const flattened = await sharp({
    create: { width: W, height: H, channels: 3, background: bg },
  })
    .composite([{ input: logoBuf, left, top }])
    .flatten({ background: bg })
    .png()
    .toBuffer();

  const { data, info } = await sharp(flattened).raw().toBuffer({ resolveWithObject: true });
  const w = info.width ?? W;
  const h = info.height ?? H;
  const rgb = rawToRgbTopDown(data, w, h, info.channels, bg);
  await Bun.write(outPath, packBmp24TopDown(W, H, rgb));
}

/** Franja superior de páginas internas: fondo + icono a la izquierda (150×57). */
async function writeHeaderStrip(outPath: string, logoPath: string, headerRgb: [number, number, number]) {
  const W = 150;
  const H = 57;
  const logoSize = 42;
  const bg = rgbObj(headerRgb);
  const padX = 10;

  const logoBuf = await sharp(logoPath).resize(logoSize, logoSize, { fit: "contain" }).ensureAlpha().png().toBuffer();

  const meta = await sharp(logoBuf).metadata();
  const lw = meta.width ?? logoSize;
  const lh = meta.height ?? logoSize;
  const left = padX;
  const top = Math.round((H - lh) / 2);

  const flattened = await sharp({
    create: { width: W, height: H, channels: 3, background: bg },
  })
    .composite([{ input: logoBuf, left, top }])
    .flatten({ background: bg })
    .png()
    .toBuffer();

  const { data, info } = await sharp(flattened).raw().toBuffer({ resolveWithObject: true });
  const w = info.width ?? W;
  const h = info.height ?? H;
  const rgb = rawToRgbTopDown(data, w, h, info.channels, bg);
  await Bun.write(outPath, packBmp24TopDown(W, H, rgb));
}

const logoPath = await resolveLogoPath();

await writeHeaderStrip(join(OUT_DIR, "header.bmp"), logoPath, HEADER_RGB);
await writeSidebarWithLogo(join(OUT_DIR, "sidebar.bmp"), logoPath);
await writeHeaderStrip(join(OUT_DIR, "uninstaller-header.bmp"), logoPath, HEADER_RGB);

console.log("NSIS branding BMPs escritos en:", OUT_DIR, "(logo:", logoPath, ")");
