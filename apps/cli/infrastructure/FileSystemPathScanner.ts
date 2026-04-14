import { existsSync, readdirSync, readFileSync } from "fs";
import { join, normalize } from "path";
import type { PathCandidate } from "@cli/domain/entities/PathCandidate";
import type { PathScanner } from "@cli/domain/ports/PathScanner";
import { folderContainsSaveLikeFiles, isExcludedFolder } from "@cli/infrastructure/scanFilters";
import { BASE_PATH_TEMPLATES_WIN32, DEFAULT_STEAM_PATH_WIN32 } from "@cli/infrastructure/scanPathTemplates";
import { resolveAppNames, extractAppId } from "@cli/infrastructure/steamAppNames";
import { expandPath } from "@cli/infrastructure/pathUtils";
import { CRACK_SAVE_LOCATIONS } from "@cli/infrastructure/crackSaveLocations";

function listSubdirs(dirPath: string): { path: string; name: string }[] {
  if (!existsSync(dirPath)) return [];
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({
        path: join(dirPath, e.name),
        name: e.name,
      }));
  } catch {
    return [];
  }
}

function scanBasePaths(basePath: string, addCandidate: (c: PathCandidate) => void): void {
  const subdirs = listSubdirs(basePath);
  for (const { path: fullPath, name } of subdirs) {
    if (isExcludedFolder(name)) continue;
    if (!folderContainsSaveLikeFiles(fullPath)) continue;
    addCandidate({ path: fullPath, folderName: name, basePath });
  }
}

// ─── Steam ──────────────────────────────────────────────────────────────────

function findSteamUserDataCandidates(steamPath: string): PathCandidate[] {
  const userdataPath = join(steamPath, "userdata");
  if (!existsSync(userdataPath)) return [];

  const candidates: PathCandidate[] = [];
  const userDirs = listSubdirs(userdataPath).filter((d) => /^\d+$/.test(d.name));

  for (const userDir of userDirs) {
    const appDirs = listSubdirs(userDir.path).filter((d) => /^\d+$/.test(d.name));
    for (const appDir of appDirs) {
      const remotePath = join(appDir.path, "remote");
      const pathToCheck = existsSync(remotePath) ? remotePath : appDir.path;
      if (!folderContainsSaveLikeFiles(pathToCheck)) continue;
      candidates.push({
        path: pathToCheck,
        folderName: `Steam App ${appDir.name}`,
        basePath: `Steam userdata (${userDir.name})`,
      });
    }
  }
  return candidates;
}

function findSteamLibraryPaths(steamPath: string): string[] {
  const vdfPath = join(steamPath, "steamapps", "libraryfolders.vdf");
  if (!existsSync(vdfPath)) return [];
  try {
    const content = readFileSync(vdfPath, "utf-8");
    const paths: string[] = [];
    const pathRegex = /"path"\s+"([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = pathRegex.exec(content)) !== null) {
      const libPath = match[1].replace(/\\\\/g, "\\");
      if (normalize(libPath).toLowerCase() !== normalize(steamPath).toLowerCase()) {
        paths.push(libPath);
      }
    }
    return paths;
  } catch {
    return [];
  }
}

function findSteamLibraryCandidates(libraryPath: string): PathCandidate[] {
  const commonPath = join(libraryPath, "steamapps", "common");
  if (!existsSync(commonPath)) return [];

  const candidates: PathCandidate[] = [];
  const gameDirs = listSubdirs(commonPath);
  for (const { path: fullPath, name } of gameDirs) {
    if (!folderContainsSaveLikeFiles(fullPath)) continue;
    candidates.push({
      path: fullPath,
      folderName: name,
      basePath: `Steam Library (${libraryPath})`,
    });
  }
  return candidates;
}

/**
 * Busca saves en las carpetas de cracks conocidos.
 * Apunta a la carpeta del AppID completa (no la subcarpeta más profunda),
 * para que al sincronizar se incluya toda la estructura de archivos.
 */
function findCrackSaveCandidates(): PathCandidate[] {
  const candidates: PathCandidate[] = [];

  for (const loc of CRACK_SAVE_LOCATIONS) {
    const basePath = expandPath(loc.path);
    if (!basePath || !existsSync(basePath)) continue;

    const appDirs = listSubdirs(basePath);
    for (const appDir of appDirs) {
      if (appDir.name === "steam_settings" || appDir.name === "settings") continue;
      if (!containsSavesAtAnyDepth(appDir.path)) continue;
      candidates.push({
        path: appDir.path,
        folderName: `${loc.label} — ${appDir.name}`,
        basePath: `${loc.label} (${basePath})`,
      });
    }
  }

  return candidates;
}

/**
 * Verifica si una carpeta contiene archivos de guardado en cualquier nivel
 * de profundidad (hasta 5 niveles). Útil para cracks que anidan bastante.
 */
function containsSavesAtAnyDepth(dirPath: string, depth = 0): boolean {
  if (depth > 5 || !existsSync(dirPath)) return false;
  if (folderContainsSaveLikeFiles(dirPath)) return true;

  try {
    const subdirs = listSubdirs(dirPath);
    for (const sub of subdirs) {
      if (sub.name === "steam_settings" || sub.name === "settings") continue;
      if (containsSavesAtAnyDepth(sub.path, depth + 1)) return true;
    }
  } catch {
    /* sin permiso */
  }

  return false;
}

// ─── Scanner principal ──────────────────────────────────────────────────────

export class FileSystemPathScanner implements PathScanner {
  async scan(extraPaths?: readonly string[]): Promise<PathCandidate[]> {
    const templates = process.platform === "win32" ? BASE_PATH_TEMPLATES_WIN32 : this.getUnixTemplates();
    const candidates: PathCandidate[] = [];
    const seenPaths = new Set<string>();

    const addCandidate = (c: PathCandidate) => {
      const key = normalize(c.path).toLowerCase();
      if (seenPaths.has(key)) return;
      seenPaths.add(key);
      candidates.push(c);
    };

    for (const template of templates) {
      const basePath = expandPath(template);
      if (!basePath || !existsSync(basePath)) continue;
      scanBasePaths(basePath, addCandidate);
    }

    if (process.platform === "win32") {
      this.scanSteam(addCandidate);
      this.scanCracks(addCandidate);
    }

    if (extraPaths) {
      const systemRoot = this.getSystemRoot();
      for (const extra of extraPaths) {
        if (!extra || !existsSync(extra)) continue;
        if (systemRoot && normalize(extra).toLowerCase() === systemRoot) continue;
        scanBasePaths(extra, addCandidate);
      }
    }

    await this.resolveNumericNames(candidates);
    return candidates;
  }

  /**
   * Reemplaza folderNames con AppIDs numéricos por nombres reales de Steam.
   * "Steam App 2551020" → "Darktide (2551020)"
   * "EMPRESS — 2050650" → "EMPRESS — Resident Evil 4 (2050650)"
   */
  private async resolveNumericNames(candidates: PathCandidate[]): Promise<void> {
    const idsToResolve: string[] = [];

    for (const c of candidates) {
      const appId = extractAppId(c.folderName);
      if (appId) idsToResolve.push(appId);
    }

    if (idsToResolve.length === 0) return;

    const names = await resolveAppNames([...new Set(idsToResolve)]);
    if (names.size === 0) return;

    for (let i = 0; i < candidates.length; i++) {
      const appId = extractAppId(candidates[i].folderName);
      if (!appId || !names.has(appId)) continue;

      const gameName = names.get(appId)!;
      const oldName = candidates[i].folderName;

      let newName: string;
      if (oldName.startsWith("Steam App ")) {
        newName = `${gameName} (${appId})`;
      } else {
        const prefix = oldName.split("—")[0].trim();
        newName = `${prefix} — ${gameName} (${appId})`;
      }

      candidates[i] = { ...candidates[i], folderName: newName };
    }
  }

  private scanSteam(addCandidate: (c: PathCandidate) => void): void {
    const steamPath = DEFAULT_STEAM_PATH_WIN32;
    if (!existsSync(steamPath)) return;

    for (const c of findSteamUserDataCandidates(steamPath)) {
      addCandidate(c);
    }

    for (const c of findSteamLibraryCandidates(steamPath)) {
      addCandidate(c);
    }

    const extraLibs = findSteamLibraryPaths(steamPath);
    for (const lib of extraLibs) {
      for (const c of findSteamLibraryCandidates(lib)) {
        addCandidate(c);
      }
    }
  }

  private scanCracks(addCandidate: (c: PathCandidate) => void): void {
    for (const c of findCrackSaveCandidates()) {
      addCandidate(c);
    }
  }

  private getSystemRoot(): string | null {
    if (process.platform !== "win32") return null;
    const drive = process.env.SystemDrive ?? "C:";
    return normalize(`${drive}\\`).toLowerCase();
  }

  private getUnixTemplates(): string[] {
    const home = process.env.HOME ?? "";
    if (!home) return [];
    return [`${home}/.local/share`, `${home}/.config`, `${home}/Documents`];
  }
}
