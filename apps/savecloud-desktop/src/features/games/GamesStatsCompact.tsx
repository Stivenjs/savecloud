import {
  Button,
  Code,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  useDisclosure,
} from "@heroui/react";
import { Cloud, CloudOff, Gamepad2, HardDrive, Info } from "lucide-react";
import { formatGameDisplayName } from "@utils/gameImage";
import { formatLastSync, formatSize } from "@utils/format";
import type { CloudGameSummary } from "@hooks/useLastSyncInfo";

interface GamesStatsCompactProps {
  gamesCount: number;
  lastSyncAt: Date | null;
  lastSyncGameId?: string | null;
  lastSyncLoading?: boolean;
  hasSyncConfig?: boolean;
  cloudGames?: CloudGameSummary[];
  totalCloudSize?: number;
  onConfigureFromCloud?: (gameId: string) => void;
}

export function GamesStatsCompact({
  gamesCount,
  lastSyncAt,
  lastSyncGameId,
  lastSyncLoading = false,
  hasSyncConfig = false,
  cloudGames = [],
  totalCloudSize = 0,
  onConfigureFromCloud,
}: GamesStatsCompactProps) {
  const showCloudSection = hasSyncConfig;
  const hasCloudGames = cloudGames.length > 0;
  const useModal = cloudGames.length > 8;

  const { isOpen, onOpen, onOpenChange } = useDisclosure();

  /**
   * 🔹 Contenido reutilizable para modal/popover
   */
  const cloudDetailContent = (
    <ul className="space-y-2">
      {cloudGames.map((g) => (
        <li key={g.gameId} className="flex flex-col gap-1 rounded-lg bg-default-100 px-3 py-2">
          {/* Nombre + tamaño */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-foreground">{formatGameDisplayName(g.gameId)}</span>
            <span className="shrink-0 text-xs text-default-500">
              {g.fileCount} archivo{g.fileCount !== 1 ? "s" : ""} · {formatSize(g.totalSize)}
            </span>
          </div>

          {/* ID + acción */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Code size="sm" className="max-w-[200px] truncate">
              {g.gameId}
            </Code>

            {onConfigureFromCloud && (
              <Button size="sm" variant="light" className="h-7 text-xs" onPress={() => onConfigureFromCloud(g.gameId)}>
                Configurar
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );

  /**
   * 🔹 Botón info reutilizable
   */
  const infoButton = (
    <button
      type="button"
      className="
        flex size-6 shrink-0 items-center justify-center
        rounded-full bg-default-100 text-default-600
        transition-all hover:bg-default-200 hover:text-foreground hover:scale-105
      ">
      <Info size={14} />
    </button>
  );

  return (
    <div
      className="
        w-full
        rounded-lg border border-default-200 bg-default-50
        px-3 py-3 sm:px-4 sm:py-4
      ">
      {/* 🔥 GRID RESPONSIVE (FIX PRINCIPAL) */}
      <div
        className="
          grid gap-3
          grid-cols-1
          sm:grid-cols-2
          lg:grid-cols-3
          text-sm
        ">
        {/* ========================= */}
        {/* 🎮 Juegos configurados */}
        {/* ========================= */}
        <div className="flex items-center gap-2 rounded-md bg-transparent">
          <Gamepad2 size={16} className="text-primary shrink-0" />

          <span className="font-semibold text-foreground">{gamesCount}</span>

          <span className="text-xs text-default-500">
            juego{gamesCount !== 1 ? "s" : ""} configurado
            {gamesCount !== 1 ? "s" : ""}
          </span>
        </div>

        {/* ========================= */}
        {/* ☁️ Última sincronización */}
        {/* ========================= */}
        <div className="flex flex-wrap items-center gap-2">
          {lastSyncLoading ? (
            <Spinner size="sm" color="primary" />
          ) : lastSyncAt ? (
            <Cloud size={16} className="text-primary shrink-0" />
          ) : (
            <CloudOff size={16} className="text-default-500 shrink-0" />
          )}

          <span className="font-semibold text-foreground">
            {lastSyncLoading ? "cargando..." : lastSyncAt ? formatLastSync(lastSyncAt) : "nunca"}
          </span>

          <span className="text-xs text-default-500">última sincronización</span>

          {lastSyncAt && lastSyncGameId && (
            <span className="text-xs text-default-400 break-all">({formatGameDisplayName(lastSyncGameId)})</span>
          )}
        </div>

        {/* ========================= */}
        {/* 💾 Nube */}
        {/* ========================= */}
        {showCloudSection && (
          <div className="flex flex-wrap items-center gap-2">
            {lastSyncLoading ? (
              <Spinner size="sm" color="primary" />
            ) : (
              <HardDrive size={16} className="text-secondary shrink-0" />
            )}

            <span className="font-semibold text-foreground">
              {lastSyncLoading ? "cargando..." : hasCloudGames ? formatSize(totalCloudSize) : "vacío"}
            </span>

            <span className="text-xs text-default-500">
              {lastSyncLoading
                ? ""
                : hasCloudGames
                  ? `(${cloudGames.length} juego${cloudGames.length !== 1 ? "s" : ""})`
                  : "en la nube"}
            </span>

            {/* 🔹 Detalle */}
            {hasCloudGames &&
              (useModal ? (
                <>
                  <button onClick={onOpen}>{infoButton}</button>

                  <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="3xl" scrollBehavior="inside">
                    <ModalContent>
                      <ModalHeader>Guardados ({cloudGames.length})</ModalHeader>

                      <ModalBody>
                        <div className="max-h-[70vh] overflow-y-auto">{cloudDetailContent}</div>
                      </ModalBody>

                      <ModalFooter>
                        <Button onPress={() => onOpenChange()}>Cerrar</Button>
                      </ModalFooter>
                    </ModalContent>
                  </Modal>
                </>
              ) : (
                <Popover placement="bottom" showArrow>
                  <PopoverTrigger>{infoButton}</PopoverTrigger>

                  <PopoverContent
                    className="
                      w-[calc(100vw-2rem)]
                      max-w-sm
                      p-0
                    ">
                    <div className="border-b border-default-200 px-4 py-3">
                      <p className="text-sm font-medium">Guardados en la nube</p>
                    </div>

                    <div className="max-h-72 overflow-y-auto p-3">{cloudDetailContent}</div>
                  </PopoverContent>
                </Popover>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
