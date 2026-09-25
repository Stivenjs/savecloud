import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { SAVE_NAME_HINTS, STRONG_SAVE_EXTENSIONS, WEAK_SAVE_EXTENSIONS } from "@cli/infrastructure/saveExtensions";
import { EXCLUDED_FOLDER_NAMES, EXCLUDED_PARTIAL_PATTERNS } from "@cli/infrastructure/scanExclusions";

function isStrongSaveFile(name: string): boolean {
  const lower = name.toLowerCase();
  return STRONG_SAVE_EXTENSIONS.some((ext) => lower.endsWith(ext) || lower.includes(ext + "."));
}

function isWeakSaveFile(name: string): boolean {
  const lower = name.toLowerCase();
  return WEAK_SAVE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function nameHintsSave(name: string): boolean {
  const lower = name.toLowerCase();
  return SAVE_NAME_HINTS.some((h) => lower.includes(h));
}

function collectFiles(dirPath: string): string[] {
  const names: string[] = [];
  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const e of entries) {
    if (e.isFile()) {
      names.push(e.name);
    } else if (e.isDirectory() && !e.name.startsWith(".")) {
      try {
        const subEntries = readdirSync(join(dirPath, e.name), {
          withFileTypes: true,
        });
        for (const s of subEntries) {
          if (s.isFile()) names.push(s.name);
        }
      } catch {
        /* sin permiso */
      }
    }
  }
  return names;
}

/**
 * Evalúa si una carpeta (hasta 1 nivel de profundidad) parece contener guardados de juego.
 * Requiere extensiones fuertes, o múltiples archivos débiles, o archivos débiles con nombre sospechoso.
 */
export function folderContainsSaveLikeFiles(dirPath: string): boolean {
  if (!existsSync(dirPath)) return false;
  try {
    const filesToCheck = collectFiles(dirPath);
    let weakCount = 0;
    for (const name of filesToCheck) {
      if (isStrongSaveFile(name)) return true;
      if (isWeakSaveFile(name)) {
        if (nameHintsSave(name)) return true;
        weakCount++;
      }
    }
    return weakCount >= 3;
  } catch {
    return false;
  }
}

export function isExcludedFolder(folderName: string): boolean {
  const lower = folderName.toLowerCase().trim();
  if (EXCLUDED_FOLDER_NAMES.has(lower)) return true;
  return EXCLUDED_PARTIAL_PATTERNS.some((p) => lower.includes(p));
}

export { BASE_PATH_TEMPLATES_WIN32, DEFAULT_STEAM_PATH_WIN32 } from "@cli/infrastructure/scanPathTemplates";
