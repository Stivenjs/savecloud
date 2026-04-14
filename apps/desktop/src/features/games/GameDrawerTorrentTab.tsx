import { useState } from "react";
import { Button, Chip, Input, Spinner } from "@heroui/react";
import { open } from "@tauri-apps/plugin-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudUpload, Download, FileUp, FolderOpen, Link, Magnet, RefreshCw, Trash2 } from "lucide-react";
import {
  listCloudTorrents,
  uploadTorrentToCloud,
  downloadTorrentFromCloud,
  deleteCloudTorrent,
  startTorrentDownload,
  startTorrentFileDownload,
} from "@services/tauri";
import { formatBytes } from "@utils/format";
import type { GameFormState } from "@/hooks/useGameForm";

interface TorrentTabProps {
  form: GameFormState;
  setField: <K extends keyof GameFormState>(key: K, value: GameFormState[K]) => void;
  setError: (error: string | null) => void;
  gameId: string;
  savePath: string;
  mode: "add" | "edit";
  /** Si false, no se consultan ni muestran torrents en la nube (p. ej. sin sync). */
  cloudEnabled?: boolean;
}

export function GameDrawerTorrentTab({
  form,
  setField,
  setError,
  gameId,
  savePath,
  mode,
  cloudEnabled = true,
}: TorrentTabProps) {
  const queryClient = useQueryClient();
  const [localTorrentPath, setLocalTorrentPath] = useState("");
  const [uploading, setUploading] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [startingMagnet, setStartingMagnet] = useState(false);
  const [startingFile, setStartingFile] = useState(false);
  const [torrentDownloadPath, setTorrentDownloadPath] = useState("");

  const effectiveGameId = gameId.trim();
  const effectiveSavePath = savePath.trim();
  const effectiveDownloadPath = torrentDownloadPath.trim() || effectiveSavePath;

  const {
    data: cloudTorrents = [],
    isLoading: loadingCloud,
    refetch: refetchCloud,
  } = useQuery({
    queryKey: ["cloud-torrents", effectiveGameId],
    queryFn: () => listCloudTorrents(effectiveGameId),
    enabled: mode === "edit" && !!effectiveGameId && cloudEnabled,
  });

  const handleSelectTorrentFile = async () => {
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: "Seleccionar archivo .torrent",
        filters: [{ name: "Torrent", extensions: ["torrent"] }],
      });
      if (selected && typeof selected === "string") {
        setLocalTorrentPath(selected);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSelectDownloadPath = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Seleccionar carpeta de descarga del torrent",
      });
      if (selected && typeof selected === "string") {
        setTorrentDownloadPath(selected);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleUploadToCloud = async () => {
    if (!localTorrentPath || !effectiveGameId) return;
    setUploading(true);
    setError(null);
    try {
      await uploadTorrentToCloud(effectiveGameId, localTorrentPath);
      setLocalTorrentPath("");
      await queryClient.invalidateQueries({ queryKey: ["cloud-torrents", effectiveGameId] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadFromCloud = async (torrentKey: string) => {
    if (!effectiveDownloadPath) {
      setError("Configura la ruta de descarga primero.");
      return;
    }
    setDownloadingKey(torrentKey);
    setError(null);
    try {
      await downloadTorrentFromCloud(effectiveGameId, torrentKey, effectiveDownloadPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloadingKey(null);
    }
  };

  const handleDeleteFromCloud = async (torrentKey: string) => {
    setDeletingKey(torrentKey);
    setError(null);
    try {
      await deleteCloudTorrent(effectiveGameId, torrentKey);
      await queryClient.invalidateQueries({ queryKey: ["cloud-torrents", effectiveGameId] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingKey(null);
    }
  };

  const handleStartMagnet = async () => {
    if (!form.magnetLink.trim() || !effectiveDownloadPath) return;
    setStartingMagnet(true);
    setError(null);
    try {
      await startTorrentDownload(form.magnetLink.trim(), effectiveDownloadPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStartingMagnet(false);
    }
  };

  const handleStartFile = async () => {
    if (!localTorrentPath || !effectiveDownloadPath) return;
    setStartingFile(true);
    setError(null);
    try {
      await startTorrentFileDownload(localTorrentPath, effectiveDownloadPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStartingFile(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Ruta de descarga */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-default-500 flex items-center gap-1.5">
          <FolderOpen size={14} className="text-default-400" />
          Ruta de descarga
        </p>
        <div className="flex gap-2">
          <Input
            label="Carpeta de descarga"
            placeholder={effectiveSavePath || "Selecciona dónde descargar"}
            value={torrentDownloadPath}
            isReadOnly
            variant="bordered"
            classNames={{ input: "cursor-pointer" }}
            onClick={handleSelectDownloadPath}
            description={
              !torrentDownloadPath && effectiveSavePath
                ? "Por defecto usa la carpeta de guardados del juego"
                : undefined
            }
          />
          <Button isIconOnly variant="flat" aria-label="Seleccionar carpeta" onPress={handleSelectDownloadPath}>
            <FolderOpen size={18} />
          </Button>
        </div>
      </div>

      {/* Magnet Link */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-default-500 flex items-center gap-1.5">
          <Magnet size={14} className="text-default-400" />
          Magnet Link
        </p>
        <Input
          label="Magnet link"
          placeholder="magnet:?xt=urn:btih:..."
          value={form.magnetLink}
          onValueChange={(v) => setField("magnetLink", v)}
          variant="bordered"
          startContent={<Link size={16} className="text-default-400" />}
        />
        {form.magnetLink.trim() && effectiveDownloadPath && (
          <Button
            size="sm"
            color="secondary"
            variant="flat"
            startContent={<Download size={14} />}
            onPress={handleStartMagnet}
            isLoading={startingMagnet}>
            Iniciar descarga por magnet
          </Button>
        )}
      </div>

      {/* Archivo .torrent local */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-default-500 flex items-center gap-1.5">
          <FileUp size={14} className="text-default-400" />
          Archivo .torrent local
        </p>
        <div className="flex gap-2">
          <Input
            label="Archivo .torrent"
            placeholder="Selecciona un archivo .torrent"
            value={localTorrentPath ? (localTorrentPath.split(/[\\/]/).pop() ?? "") : ""}
            isReadOnly
            variant="bordered"
            classNames={{ input: "cursor-pointer" }}
            onClick={handleSelectTorrentFile}
          />
          <Button isIconOnly variant="flat" aria-label="Seleccionar .torrent" onPress={handleSelectTorrentFile}>
            <FileUp size={18} />
          </Button>
        </div>
        {localTorrentPath && (
          <div className="flex gap-2">
            {effectiveDownloadPath && (
              <Button
                size="sm"
                color="secondary"
                variant="flat"
                startContent={<Download size={14} />}
                onPress={handleStartFile}
                isLoading={startingFile}>
                Descargar contenido
              </Button>
            )}
            {effectiveGameId && (
              <Button
                size="sm"
                color="primary"
                variant="flat"
                startContent={<CloudUpload size={14} />}
                onPress={handleUploadToCloud}
                isLoading={uploading}>
                Subir a la nube
              </Button>
            )}
            {localTorrentPath && (
              <Button
                isIconOnly
                size="sm"
                variant="light"
                color="danger"
                aria-label="Limpiar selección"
                onPress={() => setLocalTorrentPath("")}>
                <Trash2 size={14} />
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Torrents en la nube */}
      {mode === "edit" && effectiveGameId && cloudEnabled && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-default-500 flex items-center gap-1.5">
              <CloudUpload size={14} className="text-default-400" />
              Torrents en la nube
            </p>
            <Button isIconOnly size="sm" variant="light" aria-label="Refrescar" onPress={() => refetchCloud()}>
              <RefreshCw size={14} />
            </Button>
          </div>

          {loadingCloud ? (
            <div className="flex items-center gap-2 py-2">
              <Spinner size="sm" />
              <span className="text-xs text-default-400">Cargando…</span>
            </div>
          ) : cloudTorrents.length === 0 ? (
            <p className="text-xs text-default-400 py-2">
              No hay archivos .torrent en la nube para este juego. Sube uno con el botón de arriba.
            </p>
          ) : (
            <div className="space-y-1.5">
              {cloudTorrents.map((t) => (
                <div
                  key={t.key}
                  className="flex items-center justify-between gap-2 rounded-lg border border-default-200 bg-default-50 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">{t.filename}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {t.size != null && (
                        <Chip size="sm" variant="flat" className="h-4 text-[10px]">
                          {formatBytes(t.size)}
                        </Chip>
                      )}
                      <span className="text-[10px] text-default-400">
                        {new Date(t.lastModified).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      color="secondary"
                      variant="flat"
                      startContent={<Download size={14} />}
                      onPress={() => handleDownloadFromCloud(t.key)}
                      isLoading={downloadingKey === t.key}
                      isDisabled={!effectiveDownloadPath}>
                      Descargar
                    </Button>
                    <Button
                      isIconOnly
                      size="sm"
                      variant="light"
                      color="danger"
                      aria-label="Eliminar torrent de la nube"
                      onPress={() => handleDeleteFromCloud(t.key)}
                      isLoading={deletingKey === t.key}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!effectiveDownloadPath && (
        <p className="text-[11px] text-warning">
          Selecciona una ruta de descarga o configura la ruta de guardados en la pestaña General.
        </p>
      )}
    </div>
  );
}
