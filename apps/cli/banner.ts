/**
 * Pantalla de bienvenida del CLI: banner ASCII + colores.
 * En desarrollo usa figlet; en el exe compilado las fuentes no están, así que
 * se usa el título pregenerado embebido en banner-title.ts.
 */
import pc from "picocolors";
import { BANNER_TITLE } from "./banner-title";

const BORDER_TOP_LEFT = "┌";
const BORDER_TOP_RIGHT = "┐";
const BORDER_BOTTOM_LEFT = "└";
const BORDER_BOTTOM_RIGHT = "┘";
const BORDER_H = "─";
const BORDER_V = "│";

/** Mascota ASCII: nube con disco (guardado en la nube). */
const ASCII_MASCOT = ["    .---.   ", "   /     \\  ", "  | O   O | ", "  |   ▽   | ", "   \\ ___ /  ", "   [_____]  "];

async function getTitleText(): Promise<string> {
  try {
    const figlet = (await import("figlet")).default;
    const text =
      (await figlet.text("SaveCloud", {
        font: "Standard",
        horizontalLayout: "fitted",
      })) ?? "";
    if (text.trim().length > 0) return text;
  } catch {
    // En el exe compilado figlet no tiene las fuentes en disco; usamos el título embebido
  }
  return BANNER_TITLE;
}

export async function printWelcomeBanner(): Promise<void> {
  const title = await getTitleText();

  const tagline = "Guardados en la nube";
  const hint = "Usa las flechas para elegir, Enter para confirmar";
  const titleLines = title.split("\n").filter((l) => l.length > 0);
  const titleWidth = Math.max(...titleLines.map((l) => l.length), tagline.length);
  const mascotWidth = Math.max(...ASCII_MASCOT.map((l) => l.length));
  const innerWidth = titleWidth + 2 + mascotWidth;
  const pad = (s: string, w: number) => s.padEnd(w);

  const top = BORDER_TOP_LEFT + BORDER_H.repeat(innerWidth + 2) + BORDER_TOP_RIGHT;
  const bottom = BORDER_BOTTOM_LEFT + BORDER_H.repeat(innerWidth + 2) + BORDER_BOTTOM_RIGHT;
  const maxLines = Math.max(titleLines.length, ASCII_MASCOT.length);
  const mascotPadded = [...ASCII_MASCOT].concat(Array(maxLines - ASCII_MASCOT.length).fill("".padEnd(mascotWidth)));
  const titlePadded = titleLines.concat(Array(maxLines - titleLines.length).fill("")).map((l) => pad(l, titleWidth));

  console.log("");
  console.log(pc.cyan(top));
  for (let i = 0; i < maxLines; i++) {
    const left = pc.bold(pc.blue(titlePadded[i] ?? ""));
    const right = pc.magenta(mascotPadded[i] ?? "");
    console.log(pc.cyan(BORDER_V) + " " + left + "  " + right + " " + pc.cyan(BORDER_V));
  }
  console.log(
    pc.cyan(BORDER_V) + " " + pc.dim(pad(tagline, titleWidth)) + "  " + "".padEnd(mascotWidth) + " " + pc.cyan(BORDER_V)
  );
  console.log(pc.cyan(bottom));
  console.log("");
  console.log(pc.dim("  " + hint));
  console.log("");
}
