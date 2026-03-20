import {
  Button,
  Card,
  CardBody,
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
import { Cloud, CloudOff, Gamepad2, HardDrive, Info, Clock } from "lucide-react";
import { formatGameDisplayName } from "@utils/gameImage";
import { formatLastSync, formatPlaytime, formatSize } from "@utils/format";
import type { CloudGameSummary } from "@hooks/useLastSyncInfo";

interface GamesStatsProps {
  gamesCount: number;
  lastSyncAt: Date | null;
  /** Nombre del último juego sincronizado (opcional). */
  lastSyncGameId?: string | null;
  /** Cargando datos de última sincronización / nube. */
  lastSyncLoading?: boolean;
  /** Si hay config de sync, mostrar card y detalle de la nube. */
  hasSyncConfig?: boolean;
  /** Juegos en la nube con conteo y tamaño (solo si hasSyncConfig). */
  cloudGames?: CloudGameSummary[];
  /** Tamaño total en la nube en bytes. */
  totalCloudSize?: number;
  /** Tiempo total de juego en segundos. */
  totalPlaytimeSeconds?: number;
  /** Cargando datos de tiempo de juego. */
  playtimeLoading?: boolean;
  /** Permite configurar un juego local a partir de un juego que solo existe en la nube. */
  onConfigureFromCloud?: (gameId: string) => void;
}

export function GamesStats({
  gamesCount,
  lastSyncAt,
  lastSyncGameId,
  lastSyncLoading = false,
  hasSyncConfig = false,
  cloudGames = [],
  totalCloudSize = 0,
  totalPlaytimeSeconds = 0,
  playtimeLoading = false,
  onConfigureFromCloud,
}: GamesStatsProps) {
  const showCloudSection = hasSyncConfig;
  const hasCloudGames = cloudGames.length > 0;
  const useModal = cloudGames.length > 8;
  const { isOpen, onOpen, onOpenChange } = useDisclosure();

  // Contenido compartido para el detalle de la nube (Popover o Modal)
  const cloudDetailContent = (
    <ul className="space-y-2">
      {cloudGames.map((g) => (
        <li key={g.gameId} className="flex flex-col gap-1 rounded-lg bg-default-100 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-foreground">{formatGameDisplayName(g.gameId)}</span>
            <span className="shrink-0 text-xs text-default-500">
              {g.fileCount} archivo{g.fileCount !== 1 ? "s" : ""} · {formatSize(g.totalSize)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Code size="sm" className="max-w-[200px] truncate text-[10px]">
              {g.gameId}
            </Code>
            {onConfigureFromCloud && (
              <Button
                size="sm"
                variant="flat"
                color="primary"
                className="h-7 text-xs"
                onPress={() => onConfigureFromCloud(g.gameId)}>
                Configurar
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-4">
      {/* Grid responsivo: cambia de 3 a 4 columnas según si hay config de nube */}
      <div
        className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${showCloudSection ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        {/* CARD: Juegos Locales */}
        <Card className="border border-default-200 shadow-sm">
          <CardBody className="flex flex-row items-center gap-4 py-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <Gamepad2 size={24} className="text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-default-500">Juegos locales</p>
              <p className="text-2xl font-semibold text-foreground">{gamesCount}</p>
            </div>
          </CardBody>
        </Card>

        {/* CARD: Tiempo Total  */}
        <Card className="border border-default-200 shadow-sm">
          <CardBody className="flex flex-row items-center gap-4 py-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-warning/10">
              {playtimeLoading ? <Spinner size="sm" color="warning" /> : <Clock size={24} className="text-warning" />}
            </div>
            <div className="min-w-0">
              <p className="text-sm text-default-500">Tiempo total</p>
              <p className="text-2xl font-semibold text-foreground">
                {playtimeLoading ? "..." : formatPlaytime(totalPlaytimeSeconds)}
              </p>
            </div>
          </CardBody>
        </Card>

        {/* CARD: Última Sincronización */}
        <Card className="border border-default-200 shadow-sm">
          <CardBody className="flex flex-row items-center gap-4 py-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-default-100">
              {lastSyncLoading ? (
                <Spinner size="sm" color="primary" />
              ) : lastSyncAt ? (
                <Cloud size={24} className="text-primary" />
              ) : (
                <CloudOff size={24} className="text-default-500" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-default-500">Sincronización</p>
              <p className="truncate text-lg font-medium text-foreground">
                {lastSyncLoading ? "..." : lastSyncAt ? formatLastSync(lastSyncAt) : "Nunca"}
              </p>
              {lastSyncAt && lastSyncGameId && !lastSyncLoading && (
                <p className="truncate text-xs text-default-400">{formatGameDisplayName(lastSyncGameId)}</p>
              )}
            </div>
          </CardBody>
        </Card>

        {/* CARD: Espacio en la Nube */}
        {showCloudSection && (
          <Card className="border border-default-200 shadow-sm">
            <CardBody className="flex flex-row items-center gap-4 py-5">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary/10">
                {lastSyncLoading ? (
                  <Spinner size="sm" color="secondary" />
                ) : (
                  <HardDrive size={24} className="text-secondary" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-default-500">En la nube</p>
                <div className="flex items-baseline gap-1">
                  <p className="text-lg font-medium text-foreground">
                    {lastSyncLoading ? "..." : formatSize(totalCloudSize)}
                  </p>
                  {!lastSyncLoading && hasCloudGames && (
                    <span className="text-xs text-default-400">({cloudGames.length} j.)</span>
                  )}
                </div>
              </div>

              {/* Gatillo para ver el desglose */}
              {hasCloudGames && !lastSyncLoading && (
                <div className="shrink-0">
                  {useModal ? (
                    <Button
                      isIconOnly
                      size="sm"
                      variant="light"
                      onPress={onOpen}
                      className="text-default-400 hover:text-foreground">
                      <Info size={18} />
                    </Button>
                  ) : (
                    <Popover placement="bottom-end" showArrow>
                      <PopoverTrigger>
                        <Button isIconOnly size="sm" variant="light" className="text-default-400 hover:text-foreground">
                          <Info size={18} />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 p-0">
                        <div className="border-b border-default-200 px-4 py-3">
                          <p className="text-sm font-medium text-foreground">Detalle de la nube</p>
                        </div>
                        <div className="max-h-72 overflow-y-auto p-3">{cloudDetailContent}</div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        )}
      </div>

      {/* Modal para cuando hay muchos juegos en la nube */}
      {useModal && (
        <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="2xl" scrollBehavior="inside" backdrop="blur">
          <ModalContent>
            <ModalHeader className="flex flex-col gap-1">
              <p className="text-lg font-medium">Juegos en la nube</p>
              <p className="text-xs font-normal text-default-500">
                Total archivos: {cloudGames.reduce((acc, curr) => acc + curr.fileCount, 0)} · Peso:{" "}
                {formatSize(totalCloudSize)}
              </p>
            </ModalHeader>
            <ModalBody>
              <div className="pb-4">{cloudDetailContent}</div>
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={() => onOpenChange()}>
                Cerrar
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </div>
  );
}
