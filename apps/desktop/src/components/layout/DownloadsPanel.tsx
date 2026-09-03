import { useBigPictureConsole } from "@hooks/useBigPictureConsole";
import { useDownloadsData } from "./downloads/useDownloadsData";
import { ConsoleDownloadsWidget } from "./downloads/ConsoleDownloadsWidget";
import { DesktopDownloadsWidget } from "./downloads/DesktopDownloadsWidget";

export interface DownloadsPanelProps {
  consoleMode?: boolean;
}

/**
 * Panel modular de descargas (Steam Catalog, Torrents, Sync, Fuentes).
 * Preserva el diseño visual exacto original y adapta su posicionamiento
 * dinámicamente cuando está en modo consola (elevado sobre la barra de control hints).
 */
export function DownloadsPanel({ consoleMode }: DownloadsPanelProps) {
  const isConsoleFromContext = useBigPictureConsole();
  const isConsole = consoleMode ?? isConsoleFromContext;
  const data = useDownloadsData();

  if (isConsole) {
    return <ConsoleDownloadsWidget data={data} />;
  }

  return <DesktopDownloadsWidget data={data} />;
}
