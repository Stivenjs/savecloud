/**
 * Genera BMP 24 bits para el instalador NSIS (MUI).
 * NSIS espera bitmaps; Tauri los referencia en bundle.windows.nsis.
 *
 * Ejecutar desde apps/desktop: `bun run scripts/generate-nsis-branding-bmps.ts`
 */
import { join } from "path";

const OUT_DIR = join(import.meta.dir, "../src-tauri/windows/nsis");

/** Color de marca (RGB) — mismo tono oscuro que la UI SaveCloud */
const HEADER_RGB: [number, number, number] = [18, 18, 28];
const SIDEBAR_RGB: [number, number, number] = [14, 20, 40];

function buildBmp24(width: number, height: number, rgb: [number, number, number]): Buffer {
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
  dib.writeInt32LE(height, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(24, 14);
  dib.writeUInt32LE(0, 16);
  dib.writeUInt32LE(pixelDataSize, 20);

  const pixels = Buffer.alloc(pixelDataSize);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = y * rowSize + x * 3;
      pixels[o] = rgb[2];
      pixels[o + 1] = rgb[1];
      pixels[o + 2] = rgb[0];
    }
  }

  return Buffer.concat([header, dib, pixels]);
}

async function writeBmp24(path: string, width: number, height: number, rgb: [number, number, number]) {
  await Bun.write(path, buildBmp24(width, height, rgb));
}

await writeBmp24(join(OUT_DIR, "header.bmp"), 150, 57, HEADER_RGB);
await writeBmp24(join(OUT_DIR, "sidebar.bmp"), 164, 314, SIDEBAR_RGB);
await writeBmp24(join(OUT_DIR, "uninstaller-header.bmp"), 150, 57, HEADER_RGB);

console.log("NSIS branding BMPs escritos en:", OUT_DIR);
