import { useState } from "react";
import { Button, Card, CardBody, Input, Tooltip, Chip, Switch } from "@heroui/react";
import {
  FileJson,
  FolderOpen,
  Trash2,
  Download,
  Globe,
  Files,
  FolderInput,
  Save,
  RefreshCw,
  Plus,
  Power,
  Archive,
} from "lucide-react";
import type { RemoteSourceConfig, SourceCatalogSummary } from "@services/tauri/sources.service";
import { getSourceDisplayName } from "@utils/format";

type Props = {
  sourceUrl: string;
  defaultDownloadDir: string;
  sourcesBusy: boolean;
  sources: SourceCatalogSummary[];
  remoteSourceUrl: string;
  remoteSources: RemoteSourceConfig[];
  deletingSourceIds: Set<string>;
  deletingRemoteSourceIds: Set<string>;
  onSourceUrlChange: (value: string) => void;
  onRemoteSourceUrlChange: (value: string) => void;
  onDefaultDownloadDirChange: (value: string) => void;
  onImportUrl: () => void;
  onImportFile: () => void;
  onImportBatch: () => void;
  onRegisterRemoteSource: () => void;
  onToggleRemoteSourceEnabled: (sourceId: string, enabled: boolean) => void;
  onDeleteRemoteSource: (sourceId: string) => void;
  onSyncRemoteSources: () => void;
  onPickFolder: () => void;
  onSaveDefaultDir: () => void;
  onDeleteSource: (sourceId: string) => void;
  autoExtractDownloads: boolean;
  onAutoExtractDownloadsChange: (value: boolean) => void;
};

export function SourceInstallSettingsCard(props: Props) {
  const [hoveredSourceId, setHoveredSourceId] = useState<string | null>(null);

  const totalDownloads = props.sources.reduce((acc, s) => acc + s.downloadsCount, 0);

  return (
    <Card className="shadow-sm">
      <CardBody className="gap-5 p-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Download size={18} className="text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-default-900">Instalación desde fuentes</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-default-500">
              Importa catálogos JSON (por URL o archivo) y configura la carpeta destino para las descargas.
            </p>
          </div>
          {props.sources.length > 0 && (
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Chip size="sm" variant="flat" color="primary" className="h-5 text-[10px]">
                {props.sources.length} {props.sources.length === 1 ? "fuente" : "fuentes"}
              </Chip>
              <span className="text-[10px] text-default-400">{totalDownloads.toLocaleString()} juegos</span>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="h-px bg-default-100" />

        {/* Import from file buttons */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5">
            <FileJson size={13} className="text-default-500" />
            <span className="text-xs font-medium text-default-600">Importar desde archivos</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="flat"
              isLoading={props.sourcesBusy}
              onPress={props.onImportFile}
              startContent={!props.sourcesBusy && <FileJson size={13} />}
              className="h-8 text-xs">
              Archivo JSON
            </Button>
            <Button
              size="sm"
              variant="flat"
              color="secondary"
              isLoading={props.sourcesBusy}
              onPress={props.onImportBatch}
              startContent={!props.sourcesBusy && <Files size={13} />}
              className="h-8 text-xs">
              Múltiples JSONs
            </Button>
          </div>
        </div>

        {/* Remote sources */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5">
            <RefreshCw size={13} className="text-default-500" />
            <span className="text-xs font-medium text-default-600">Fuentes remotas registradas</span>
            {props.remoteSources.length > 0 && (
              <Chip size="sm" variant="flat" color="secondary" className="h-5 text-[10px]">
                {props.remoteSources.length}
              </Chip>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              size="sm"
              placeholder="https://example.com/catalog.json"
              value={props.remoteSourceUrl}
              onValueChange={props.onRemoteSourceUrlChange}
              isDisabled={props.sourcesBusy}
              startContent={<Plus size={13} className="shrink-0 text-default-400" />}
              classNames={{
                input: "text-xs",
                inputWrapper: "h-9",
              }}
            />
            <Button
              size="sm"
              variant="flat"
              color="secondary"
              isLoading={props.sourcesBusy}
              isDisabled={!props.remoteSourceUrl.trim()}
              onPress={props.onRegisterRemoteSource}
              className="h-9 shrink-0 px-4 text-xs font-medium">
              Agregar
            </Button>
            <Button
              size="sm"
              color="primary"
              variant="flat"
              isLoading={props.sourcesBusy}
              onPress={props.onSyncRemoteSources}
              startContent={<RefreshCw size={13} />}
              className="h-9 shrink-0 px-4 text-xs font-medium">
              Sincronizar todo
            </Button>
          </div>

          {props.remoteSources.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-default-200 bg-default-50">
              <div className="max-h-56 divide-y divide-default-100 overflow-y-auto">
                {props.remoteSources.map((source) => {
                  const isDeleting = props.deletingRemoteSourceIds.has(source.id);
                  const hasError = !!source.sync.syncError;

                  return (
                    <div key={source.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-default-200 text-default-500">
                        <Globe size={13} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-default-800">{source.url}</p>
                        <p
                          className={`mt-0.5 truncate text-[10px] ${hasError ? "text-danger-500" : "text-default-400"}`}>
                          {hasError ? source.sync.syncError : source.enabled ? "Activa" : "Pausada"}
                        </p>
                      </div>

                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        color={source.enabled ? "success" : "default"}
                        isDisabled={props.sourcesBusy || isDeleting}
                        onPress={() => props.onToggleRemoteSourceEnabled(source.id, !source.enabled)}
                        className="h-7 w-7 min-w-0 shrink-0"
                        aria-label={source.enabled ? "Pausar fuente remota" : "Activar fuente remota"}>
                        <Power size={13} />
                      </Button>

                      <Tooltip
                        content={isDeleting ? "Eliminando..." : "Eliminar fuente remota"}
                        placement="left"
                        delay={300}>
                        <Button
                          isIconOnly
                          size="sm"
                          variant="light"
                          color="danger"
                          isLoading={isDeleting}
                          isDisabled={props.sourcesBusy || isDeleting}
                          onPress={() => props.onDeleteRemoteSource(source.id)}
                          className="h-7 w-7 min-w-0 shrink-0"
                          aria-label="Eliminar fuente remota">
                          {!isDeleting && <Trash2 size={13} />}
                        </Button>
                      </Tooltip>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-default-200 px-3 py-4 text-center text-[11px] text-default-400">
              No hay URLs remotas registradas todavía.
            </div>
          )}
        </div>

        {/* Sources List */}
        {props.sources.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <FolderInput size={13} className="text-default-500" />
              <span className="text-xs font-medium text-default-600">Catálogos importados</span>
            </div>
            <div className="overflow-hidden rounded-xl border border-default-200 bg-default-50">
              <div className="max-h-52 divide-y divide-default-100 overflow-y-auto">
                {props.sources.map((source) => {
                  const isDeleting = props.deletingSourceIds.has(source.id);
                  const isHovered = hoveredSourceId === source.id;
                  const isFromFile = source.sourceUrl?.startsWith("file://");
                  const displayUrl = source.sourceUrl
                    ? isFromFile
                      ? getSourceDisplayName(source.sourceUrl)
                      : source.sourceUrl
                    : null;

                  return (
                    <div
                      key={source.id}
                      className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-default-100"
                      onMouseEnter={() => setHoveredSourceId(source.id)}
                      onMouseLeave={() => setHoveredSourceId(null)}>
                      {/* Source icon */}
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-default-200 text-default-500">
                        {isFromFile ? <FileJson size={13} /> : <Globe size={13} />}
                      </div>

                      {/* Source info */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-default-800">{source.name}</p>
                        {displayUrl && (
                          <Tooltip content={displayUrl} placement="bottom" delay={500}>
                            <p className="mt-0.5 truncate text-[10px] text-default-400 cursor-default">{displayUrl}</p>
                          </Tooltip>
                        )}
                      </div>

                      {/* Downloads count badge */}
                      <Chip
                        size="sm"
                        variant="flat"
                        className={`h-5 shrink-0 text-[10px] transition-opacity ${
                          isHovered && !isDeleting ? "opacity-0" : "opacity-100"
                        }`}>
                        {source.downloadsCount.toLocaleString()}
                      </Chip>

                      {/* Delete button */}
                      <Tooltip content={isDeleting ? "Eliminando..." : "Eliminar fuente"} placement="left" delay={300}>
                        <Button
                          isIconOnly
                          size="sm"
                          variant="light"
                          color="danger"
                          isLoading={isDeleting}
                          isDisabled={isDeleting || props.sourcesBusy}
                          onPress={() => props.onDeleteSource(source.id)}
                          className={`h-7 w-7 min-w-0 shrink-0 transition-all ${
                            isHovered || isDeleting ? "opacity-100 scale-100" : "opacity-0 scale-90"
                          }`}
                          aria-label={`Eliminar ${source.name}`}>
                          {!isDeleting && <Trash2 size={13} />}
                        </Button>
                      </Tooltip>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {props.sources.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-default-200 py-6 text-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-default-100">
              <FileJson size={16} className="text-default-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-default-500">Sin catálogos importados</p>
              <p className="mt-0.5 text-[11px] text-default-400">
                Importa un JSON de fuente para ver tus catálogos aquí.
              </p>
            </div>
          </div>
        )}

        {/* Divider */}
        <div className="h-px bg-default-100" />

        {/* Default download directory */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5">
            <FolderOpen size={13} className="text-default-500" />
            <span className="text-xs font-medium text-default-600">Carpeta destino por defecto</span>
          </div>
          <Input
            size="sm"
            placeholder="D:/Games/Downloads"
            value={props.defaultDownloadDir}
            onValueChange={props.onDefaultDownloadDirChange}
            startContent={<FolderOpen size={13} className="shrink-0 text-default-400" />}
            classNames={{
              input: "text-xs",
              inputWrapper: "h-9",
            }}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="flat"
              onPress={props.onPickFolder}
              startContent={<FolderOpen size={13} />}
              className="h-8 text-xs">
              Elegir carpeta
            </Button>
            <Button
              size="sm"
              color="primary"
              variant="flat"
              onPress={props.onSaveDefaultDir}
              startContent={<Save size={13} />}
              className="h-8 text-xs">
              Guardar ruta
            </Button>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-default-100" />

        {/* Auto Extraction */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5">
            <Archive size={13} className="text-default-500" />
            <span className="text-xs font-medium text-default-600">Extracción automática</span>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl border border-default-200 bg-default-50 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-default-800">Extraer juegos automáticamente</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-default-550">
                Descomprime automáticamente los archivos comprimidos al finalizar la descarga (ZIP, RAR, 7Z, TAR, etc.).
                Si está desactivado, el archivo descargado se conservará sin extraer.
              </p>
            </div>
            <Switch
              size="sm"
              isSelected={props.autoExtractDownloads}
              onValueChange={props.onAutoExtractDownloadsChange}
              aria-label="Extraer automáticamente juegos descargados"
            />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
