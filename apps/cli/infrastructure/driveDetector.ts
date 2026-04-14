import { execSync } from "child_process";
import { existsSync } from "fs";

export interface DetectedDrive {
  letter: string;
  path: string;
}

/**
 * Detecta las unidades/volúmenes montados en el sistema.
 * Windows: Get-PSDrive vía PowerShell, o fallback a A-Z.
 * Unix: parsea df.
 */
export function detectDrives(): DetectedDrive[] {
  if (process.platform === "win32") {
    return detectWindowsDrives();
  }
  return detectUnixMounts();
}

function getSystemDrive(): string {
  return (process.env.SystemDrive ?? "C:").toUpperCase();
}

function detectWindowsDrives(): DetectedDrive[] {
  const systemDrive = getSystemDrive();
  let drives: DetectedDrive[];

  try {
    const raw = execSync(
      'powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root"',
      { encoding: "utf-8", timeout: 5000 }
    );
    drives = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length >= 2 && existsSync(l))
      .map((root) => ({
        letter: root.replace(/[:\\\/]+$/, ""),
        path: root,
      }));
  } catch {
    drives = [];
    for (let code = 65; code <= 90; code++) {
      const letter = String.fromCharCode(code);
      const root = `${letter}:\\`;
      if (existsSync(root)) {
        drives.push({ letter, path: root });
      }
    }
  }

  return drives.filter((d) => d.letter.toUpperCase() !== systemDrive);
}

function detectUnixMounts(): DetectedDrive[] {
  try {
    const raw = execSync("df -h --output=target 2>/dev/null || df -h", {
      encoding: "utf-8",
      timeout: 5000,
    });
    const lines = raw.split(/\r?\n/).slice(1);
    const excluded = ["/snap", "/boot", "/sys", "/proc", "/dev", "/run"];
    return lines
      .map((l) => l.trim())
      .filter((l) => l.startsWith("/") && !excluded.some((p) => l.startsWith(p)))
      .map((mount) => ({ letter: mount, path: mount }));
  } catch {
    return [{ letter: "/", path: "/" }];
  }
}
