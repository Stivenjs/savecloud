import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type as getOsType } from "@tauri-apps/plugin-os";
import { useTranslation } from "react-i18next";
import { downloadEmulator, setEmulatorPath, type EmulatorProgressPayload } from "@services/tauri/emulators.service";
import { getUnknownErrorMessage } from "@utils/errorMessage";
import type { EmulatorProgressById } from "../types/emulatorCatalog";
import { emulatorCatalog } from "../data/emulatorCatalog";

interface EmulatorReleaseResponse {
  assets?: Array<{ name?: string; browser_download_url?: string }>;
}

/** Busca el primer asset que cumple el formato declarado por el catálogo. */
function findReleaseAsset(releases: EmulatorReleaseResponse[], nameIncludes: string[], extension: string) {
  return releases
    .flatMap((release) => release.assets ?? [])
    .find((asset) => {
      const name = asset.name?.toLowerCase();
      return name?.endsWith(extension) && nameIncludes.every((fragment) => name.includes(fragment.toLowerCase()));
    });
}

/** Resuelve el asset compatible usando la metadata del catálogo del emulador. */
async function resolveDownload(emulatorId: string) {
  const emulator = emulatorCatalog.find(({ id }) => id === emulatorId);
  if (!emulator) throw new Error(`Emulador desconocido: ${emulatorId}`);

  const os = await getOsType();
  const platform = os.toLowerCase().startsWith("win")
    ? "windows"
    : os.toLowerCase().startsWith("mac") || os.toLowerCase().startsWith("darwin")
      ? "macos"
      : os.toLowerCase().startsWith("linux")
        ? "linux"
        : null;
  if (!platform) throw new Error(`No hay descargas disponibles para ${os}`);

  const source = emulator.releaseAssets[platform];
  if (!source) throw new Error(`No hay una descarga configurada para ${platform}`);

  const response = await fetch(source.apiUrl, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`No se pudo consultar la release (${response.status})`);
  const latestRelease = (await response.json()) as EmulatorReleaseResponse;
  let asset = findReleaseAsset([latestRelease], source.nameIncludes, source.extension);
  if (!asset) {
    const releasesUrl = source.apiUrl.replace(/\/latest(?:\?.*)?$/, "");
    const historyResponse = await fetch(`${releasesUrl}?per_page=10`, {
      headers: { Accept: "application/json" },
    });
    if (historyResponse.ok) {
      const releaseHistory = (await historyResponse.json()) as EmulatorReleaseResponse[];
      asset = findReleaseAsset(releaseHistory, source.nameIncludes, source.extension);
    }
  }
  if (!asset?.name || !asset.browser_download_url) {
    throw new Error(`No se encontró una descarga de ${platform} para ${emulator.name}`);
  }
  if (source.artifactType !== "archive" && source.artifactType !== "appImage") {
    throw new Error(`Tipo de descarga no compatible: ${source.artifactType}`);
  }

  return {
    emulator: emulator.id,
    downloadUrl: asset.browser_download_url,
    fileName: asset.name,
    artifactType: source.artifactType,
  } as const;
}

interface UseEmulatorActionsOptions {
  setProgresses: Dispatch<SetStateAction<EmulatorProgressById>>;
  refreshStatus: () => void;
}

/** Acciones de instalación, selección de ejecutable y navegación a enlaces oficiales. */
export function useEmulatorActions({ setProgresses, refreshStatus }: UseEmulatorActionsOptions) {
  const { t } = useTranslation();

  const pickExecutable = useCallback(
    async (emulatorId: string, emulatorName: string) => {
      try {
        const selected = await open({
          directory: false,
          multiple: false,
          title: t("settings.emulators.selectExecutableTitle", { name: emulatorName }),
          filters: [{ name: t("settings.emulators.allFilesFilter"), extensions: ["*"] }],
        });
        if (typeof selected === "string" && selected.length > 0) {
          await setEmulatorPath(emulatorId, selected);
          refreshStatus();
        }
      } catch (error) {
        console.error("No se pudo seleccionar el ejecutable del emulador:", error);
      }
    },
    [refreshStatus, t]
  );

  const install = useCallback(
    async (emulatorId: string) => {
      setProgresses((previous) => ({
        ...previous,
        [emulatorId]: {
          emulator: emulatorId,
          status: "downloading",
          loaded: 0,
          total: 0,
          speed: 0,
          eta: null,
        },
      }));

      try {
        const request = await resolveDownload(emulatorId);
        await downloadEmulator(request);
      } catch (error) {
        const failedProgress: EmulatorProgressPayload = {
          emulator: emulatorId,
          status: "failed",
          loaded: 0,
          total: 0,
          error: getUnknownErrorMessage(error),
        };
        setProgresses((previous) => ({ ...previous, [emulatorId]: failedProgress }));
      }
    },
    [setProgresses]
  );

  const openExternal = useCallback(async (url: string) => {
    try {
      await openUrl(url);
    } catch (error) {
      console.error("No se pudo abrir el enlace del emulador:", error);
    }
  }, []);

  return { pickExecutable, install, openExternal };
}
