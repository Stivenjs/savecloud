import {
  Button,
  Code,
  Input,
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
import { Cloud, CloudOff, Database, Gamepad2, RefreshCw, Search, X } from "lucide-react";
import { formatGameDisplayName } from "@utils/gameImage";
import { formatLastSync, formatSize } from "@utils/format";
import type { CloudGameSummary } from "@hooks/useLastSyncInfo";
import { useDebouncedValue } from "@hooks/useDebouncedValue";
import { useState } from "react";

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
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebouncedValue(searchQuery, 250);

  const filteredGames = cloudGames.filter((g) => {
    const term = debouncedSearch.trim().toLowerCase();
    if (!term) return true;
    return g.gameId.toLowerCase().includes(term) || formatGameDisplayName(g.gameId).toLowerCase().includes(term);
  });

  const cloudGamesList = (games: CloudGameSummary[]) => (
    <ul className="flex flex-col gap-2">
      {games.length === 0 ? (
        <li className="flex flex-col items-center gap-2 py-10 text-default-400">
          <Search size={22} className="opacity-30" />
          <span className="text-xs">No se encontraron juegos</span>
        </li>
      ) : (
        games.map((g) => (
          <li
            key={g.gameId}
            className="flex flex-col gap-1.5 rounded-lg border border-default-200/70 px-3 py-2.5 transition-colors hover:border-default-300 hover:bg-default-50 outline-none focus-within:ring-0 focus-within:border-default-200/70">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-foreground">{formatGameDisplayName(g.gameId)}</span>
              <span className="shrink-0 text-xs text-default-400">
                {g.fileCount} archivo{g.fileCount !== 1 ? "s" : ""} · {formatSize(g.totalSize)}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Code size="sm" className="max-w-[200px] truncate text-default-400 text-[11px]">
                {g.gameId}
              </Code>
              {onConfigureFromCloud && (
                <Button
                  size="sm"
                  variant="light"
                  className="h-6 min-w-0 px-2 text-[11px] text-default-500 cursor-pointer"
                  onPress={() => onConfigureFromCloud(g.gameId)}>
                  Configurar
                </Button>
              )}
            </div>
          </li>
        ))
      )}
    </ul>
  );

  const infoButton = (
    <button
      type="button"
      className="flex size-5 shrink-0 items-center justify-center rounded-full border border-default-200 text-default-400 transition-all hover:border-default-300 hover:bg-default-100 hover:text-default-600 cursor-pointer">
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="9" height="9">
        <circle cx="6" cy="6" r="5" />
        <path d="M6 5.5v3M6 3.5v.5" />
      </svg>
    </button>
  );

  return (
    <div className="w-full overflow-hidden rounded-xl bg-default-50">
      <div className="grid grid-cols-1 divide-y divide-default-200/80 text-sm sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {/* Juegos configurados */}
        <div className="flex flex-col gap-1 px-4 py-3.5">
          <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-default-500">
            <Gamepad2 size={12} className="text-primary" />
            juegos
          </span>
          <span className="text-xl font-medium text-foreground">
            {gamesCount}{" "}
            <span className="text-sm font-normal text-default-500">configurado{gamesCount !== 1 ? "s" : ""}</span>
          </span>
        </div>

        {/* Última sincronización */}
        <div className="flex flex-col gap-1 px-4 py-3.5">
          <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-default-500">
            <RefreshCw size={12} className="text-secondary" />
            última sincronización
          </span>
          <div className="flex items-center gap-2">
            {lastSyncLoading ? (
              <Spinner size="sm" color="default" />
            ) : lastSyncAt ? (
              <Cloud size={14} className="shrink-0 text-default-500" />
            ) : (
              <CloudOff size={14} className="shrink-0 text-default-400" />
            )}
            <span className="text-sm font-medium text-foreground">
              {lastSyncLoading ? "cargando..." : lastSyncAt ? formatLastSync(lastSyncAt) : "nunca"}
            </span>
            {lastSyncAt && lastSyncGameId && (
              <span className="truncate text-xs text-default-400">{formatGameDisplayName(lastSyncGameId)}</span>
            )}
          </div>
        </div>

        {/* Almacenamiento en nube */}
        {showCloudSection && (
          <div className="flex flex-col gap-1 px-4 py-3.5">
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-default-500">
              <Database size={12} className="text-warning" />
              almacenamiento
            </span>
            <div className="flex items-center gap-2">
              {lastSyncLoading ? (
                <Spinner size="sm" color="default" />
              ) : (
                <span className="text-base font-semibold text-foreground">
                  {hasCloudGames ? formatSize(totalCloudSize) : "vacío"}
                </span>
              )}
              {!lastSyncLoading && hasCloudGames && (
                <span className="text-xs text-default-400">
                  {cloudGames.length} juego{cloudGames.length !== 1 ? "s" : ""}
                </span>
              )}
              {hasCloudGames &&
                (useModal ? (
                  <>
                    <button type="button" onClick={onOpen}>
                      {infoButton}
                    </button>

                    <Modal
                      isOpen={isOpen}
                      onOpenChange={(open) => {
                        if (!open) setSearchQuery("");
                        onOpenChange();
                      }}
                      size="2xl"
                      scrollBehavior="inside"
                      classNames={{
                        header: "border-b border-default-200/80 pb-3",
                        footer: "border-t border-default-200/80 pt-3",
                        body: "py-3",
                        closeButton: "hidden",
                      }}>
                      <ModalContent>
                        <ModalHeader className="flex flex-col gap-2.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm font-medium">
                              <Database size={14} className="text-default-500" />
                              Guardados en la nube
                              <span className="rounded-full border border-default-200 px-2 py-0.5 text-[11px] font-normal text-default-500">
                                {cloudGames.length}
                              </span>
                            </div>
                            <Button
                              isIconOnly
                              size="sm"
                              variant="light"
                              className="size-7 min-w-0 text-default-400"
                              onPress={() => {
                                setSearchQuery("");
                                onOpenChange();
                              }}>
                              <X size={14} />
                            </Button>
                          </div>

                          <Input
                            placeholder="Buscar juego..."
                            size="sm"
                            radius="lg"
                            startContent={<Search size={13} className="text-default-400" />}
                            endContent={
                              searchQuery ? (
                                <button
                                  type="button"
                                  onClick={() => setSearchQuery("")}
                                  className="text-default-400 hover:text-default-600">
                                  <X size={13} />
                                </button>
                              ) : null
                            }
                            value={searchQuery}
                            onValueChange={setSearchQuery}
                            classNames={{
                              inputWrapper:
                                "bg-default-100/60 border border-default-200/80 shadow-none data-[hover=true]:border-default-300 data-[focus-within=true]:!border-default-300 data-[focus=true]:!border-default-300",
                            }}
                          />

                          {debouncedSearch && (
                            <p className="text-[11px] font-normal text-default-400">
                              {filteredGames.length} resultado{filteredGames.length !== 1 ? "s" : ""} para &quot;
                              {debouncedSearch}&quot;
                            </p>
                          )}
                        </ModalHeader>

                        <ModalBody>{cloudGamesList(filteredGames)}</ModalBody>

                        <ModalFooter className="flex items-center justify-between">
                          <span className="text-xs text-default-400">{formatSize(totalCloudSize)} en total</span>
                          <Button
                            size="sm"
                            variant="flat"
                            className="text-default-600"
                            onPress={() => {
                              setSearchQuery("");
                              onOpenChange();
                            }}>
                            Cerrar
                          </Button>
                        </ModalFooter>
                      </ModalContent>
                    </Modal>
                  </>
                ) : (
                  <Popover placement="bottom" showArrow={false}>
                    <PopoverTrigger>{infoButton}</PopoverTrigger>
                    <PopoverContent className="w-[calc(100vw-2rem)] max-w-xs p-0 shadow-sm border border-default-200/80">
                      <div className="border-b border-default-200/80 px-4 py-2.5">
                        <p className="text-xs font-medium text-default-600">Guardados en la nube</p>
                      </div>
                      <div className="max-h-64 overflow-y-auto p-2.5">{cloudGamesList(cloudGames)}</div>
                    </PopoverContent>
                  </Popover>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
