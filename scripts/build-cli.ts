/**
 * Build script para compilar el CLI con la API URL y API key embebidas.
 *
 * Uso:
 *   SYNC_GAMES_API_URL=https://... SYNC_GAMES_API_KEY=tu-key bun run build:cli
 */
import figures from "figures";

export {};

const apiUrl = process.env.SYNC_GAMES_API_URL;
const apiKey = process.env.SYNC_GAMES_API_KEY;

if (!apiUrl || !apiKey) {
  console.error(`${figures.cross} Faltan variables de entorno:`);
  if (!apiUrl) console.error("   - SYNC_GAMES_API_URL");
  if (!apiKey) console.error("   - SYNC_GAMES_API_KEY");
  console.error('\n   Uso: SYNC_GAMES_API_URL="https://..." SYNC_GAMES_API_KEY="..." bun run build:cli');
  process.exit(1);
}

const pkg = (await Bun.file("package.json").json()) as { version: string };
const iconPath = "assets/icon.ico";
const hasIcon = await Bun.file(iconPath).exists();

console.log(`\n${figures.bullet} Compilando CLI...`);
console.log(`   API URL: ${apiUrl}`);
console.log(`   API Key: ${"*".repeat(apiKey.length)}`);
if (hasIcon) console.log(`   Icono: ${iconPath}`);
console.log(`   Metadatos: título, versión, descripción`);
console.log(`   Bytecode: activado (arranque rápido)`);
console.log(`   Sourcemap: vinculado\n`);

const result = await Bun.build({
  entrypoints: ["src/cli/index.ts"],
  minify: true,
  target: "bun",
  bytecode: true,
  sourcemap: "none",
  define: {
    "process.env.SYNC_GAMES_API_URL": JSON.stringify(apiUrl),
    "process.env.SYNC_GAMES_API_KEY": JSON.stringify(apiKey),
  },
  compile: {
    outfile: "dist/savecloud",
    ...(process.platform === "win32" && {
      windows: {
        ...(hasIcon && { icon: iconPath }),
        title: "SaveCloud",
        version: pkg.version,
        description: "CLI para sincronizar guardados de juegos en la nube (S3)",
        publisher: "Stifts",
        copyright: `Copyright ${new Date().getFullYear()}`,
      },
    }),
  },
});

if (!result.success) {
  console.error(`${figures.cross} Build fallido:`);
  for (const msg of result.logs) console.error(msg);
  process.exit(1);
}
console.log(`\n${figures.tick} Build completado: dist/savecloud\n`);
