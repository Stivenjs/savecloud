import { memo, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardBody,
  ScrollShadow,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
} from "@heroui/react";
import { useQueryClient } from "@tanstack/react-query";
import { emitTo } from "@tauri-apps/api/event";
import { Cloud, CloudOff, Database, Gamepad2, RefreshCw } from "lucide-react";
import { SAVECLOUD_OPEN_RESTORE_FROM_CLOUD_EVENT } from "@/constants/savecloudCrossWindow";
import { CONFIG_QUERY_KEY, useConfig } from "@hooks/useConfig";
import { useProfileSession } from "@hooks/useProfileSession";
import { LAST_SYNC_QUERY_KEY, useLastSyncInfo, type CloudGameSummary } from "@hooks/useLastSyncInfo";
import { useGameMedia, useGameMediaBatch, getIsResolvingIds } from "@hooks/useGameMedia";
import { useResolvedSteamAppIds } from "@hooks/useResolvedSteamAppIds";
import { buildActiveCloudConfig } from "@utils/activeCloudConfig";
import { hasUsableCloudConnection } from "@utils/cloudConnection";
import { formatGameDisplayName } from "@utils/gameImage";
import { formatLastSync, formatRelativeDate, formatSize } from "@utils/format";
import type { ConfiguredGame } from "@app-types/config";
import type { SteamAppdetailsMediaResult } from "@services/tauri";

const MAIN_WEBVIEW_LABEL = "main";

type SortKey = "name" | "size" | "files" | "modified";

interface CloudDashboardPanelProps {
  onSelectAccountTab: () => void;
}

export function CloudDashboardPanel({ onSelectAccountTab }: CloudDashboardPanelProps) {
  const queryClient = useQueryClient();
  const { config, loading: configLoading } = useConfig();
  const { activeProfile } = useProfileSession();

  const cloudConfig = useMemo(() => buildActiveCloudConfig(config, activeProfile), [config, activeProfile]);
  const hasSyncConfig = hasUsableCloudConnection(cloudConfig);

  const {
    lastSyncAt,
    lastSyncGameId,
    cloudGames,
    totalCloudSize,
    isLoading: lastSyncLoading,
    isFetching,
    connectionStatus,
    connectionError,
  } = useLastSyncInfo(hasSyncConfig);

  const [sortKey, setSortKey] = useState<SortKey>("modified");

  const gamesCount = config?.games?.length ?? 0;
  const localGameIdsLower = useMemo(
    () => new Set((config?.games ?? []).map((g) => g.id.toLowerCase())),
    [config?.games]
  );

  const sortedGames = useMemo(() => {
    const list = [...cloudGames];
    const byName = (a: CloudGameSummary, b: CloudGameSummary) =>
      formatGameDisplayName(a.gameId).localeCompare(formatGameDisplayName(b.gameId), undefined, {
        sensitivity: "base",
      });
    switch (sortKey) {
      case "name":
        return list.sort(byName);
      case "size":
        return list.sort((a, b) => b.totalSize - a.totalSize);
      case "files":
        return list.sort((a, b) => b.fileCount - a.fileCount);
      case "modified": {
        return list.sort((a, b) => {
          const ta = a.lastModified ? new Date(a.lastModified).getTime() : 0;
          const tb = b.lastModified ? new Date(b.lastModified).getTime() : 0;
          return tb - ta;
        });
      }
      default:
        return list;
    }
  }, [cloudGames, sortKey]);

  const gamesForCloudTableMedia = useMemo((): ConfiguredGame[] => {
    return sortedGames.map((row) => {
      const fromLibrary = config?.games?.find((g) => g.id.toLowerCase() === row.gameId.toLowerCase());
      return fromLibrary ?? ({ id: row.gameId, paths: [] } as ConfiguredGame);
    });
  }, [sortedGames, config?.games]);

  const resolvedSteamAppIds = useResolvedSteamAppIds(gamesForCloudTableMedia);
  const isResolvingIds = getIsResolvingIds(gamesForCloudTableMedia, resolvedSteamAppIds);
  const { mediaBySteamAppId } = useGameMediaBatch({
    games: gamesForCloudTableMedia,
    resolvedSteamAppIds,
    isResolvingIds,
  });

  const handleRefresh = async () => {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: LAST_SYNC_QUERY_KEY }),
      queryClient.refetchQueries({ queryKey: CONFIG_QUERY_KEY }),
    ]);
  };

  const handleBringToDevice = (gameId: string) => {
    void emitTo(MAIN_WEBVIEW_LABEL, SAVECLOUD_OPEN_RESTORE_FROM_CLOUD_EVENT, { gameId });
  };

  if (configLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center gap-3 text-default-500">
        <Spinner size="md" color="default" />
        <span className="text-sm">Cargando configuración…</span>
      </div>
    );
  }

  if (!hasSyncConfig) {
    return (
      <Card className="border border-default-200/80 bg-default-50/40 dark:bg-default-100/10">
        <CardBody className="gap-3 p-5">
          <p className="text-sm text-default-600">
            No hay cuenta de nube configurada en este perfil. Configura la API en «Cuenta» para ver estadísticas y
            guardados remotos.
          </p>
          <Button color="primary" variant="flat" onPress={onSelectAccountTab}>
            Ir a Cuenta
          </Button>
        </CardBody>
      </Card>
    );
  }

  const showLoadingRow = lastSyncLoading && cloudGames.length === 0;
  const hasCloudGames = cloudGames.length > 0;

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-default-500">Resumen de la nube y detalle por juego.</p>
        <Button
          size="sm"
          variant="bordered"
          radius="md"
          className="border-default-300/70"
          startContent={<RefreshCw size={16} className={isFetching ? "animate-spin" : ""} />}
          isDisabled={isFetching}
          onPress={() => void handleRefresh()}>
          Actualizar
        </Button>
      </div>

      <div className="w-full overflow-hidden rounded-xl bg-default-50">
        <div className="grid grid-cols-1 divide-y divide-default-200/80 text-sm sm:grid-cols-3 sm:divide-x sm:divide-y-0">
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

          <div className="flex flex-col gap-1 px-4 py-3.5">
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-default-500">
              <RefreshCw size={12} className="text-secondary" />
              última sincronización
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {lastSyncLoading ? (
                <Spinner size="sm" color="default" />
              ) : lastSyncAt ? (
                <Cloud size={14} className="shrink-0 text-default-500" />
              ) : (
                <CloudOff size={14} className="shrink-0 text-default-400" />
              )}
              <span className="text-sm font-medium text-foreground">
                {lastSyncLoading ? "cargando…" : lastSyncAt ? formatLastSync(lastSyncAt) : "nunca"}
              </span>
              {lastSyncAt && lastSyncGameId ? (
                <span className="truncate text-xs text-default-400">{formatGameDisplayName(lastSyncGameId)}</span>
              ) : null}
            </div>
            {connectionStatus === "error" ? (
              <span className="text-xs text-danger" title={connectionError ?? undefined}>
                {connectionError ?? "Error al contactar la nube"}
              </span>
            ) : null}
          </div>

          <div className="flex flex-col gap-1 px-4 py-3.5">
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-default-500">
              <Database size={12} className="text-warning" />
              almacenamiento
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {lastSyncLoading ? (
                <Spinner size="sm" color="default" />
              ) : (
                <span className="text-base font-semibold text-foreground">
                  {hasCloudGames ? formatSize(totalCloudSize) : "vacío"}
                </span>
              )}
              {!lastSyncLoading && hasCloudGames ? (
                <span className="text-xs text-default-400">
                  {cloudGames.length} juego{cloudGames.length !== 1 ? "s" : ""}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <Card className="border border-default-200/80 bg-default-50/30 dark:bg-default-100/10">
        <CardBody className="flex flex-col gap-3 p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-default-200/70 px-4 py-3 dark:border-default-100/15">
            <div>
              <p className="text-sm font-medium text-foreground">Guardados en la nube</p>
              <p className="text-xs text-default-500">
                Ordena por columna. «Traer a este equipo» abre el asistente en la ventana principal.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(["modified", "name", "size", "files"] as const).map((key) => (
                <Button
                  key={key}
                  size="sm"
                  variant={sortKey === key ? "flat" : "light"}
                  color={sortKey === key ? "primary" : "default"}
                  className="min-w-0"
                  onPress={() => setSortKey(key)}>
                  {key === "modified" && "Última modif."}
                  {key === "name" && "Nombre"}
                  {key === "size" && "Tamaño"}
                  {key === "files" && "Archivos"}
                </Button>
              ))}
            </div>
          </div>

          <ScrollShadow className="max-h-[min(520px,55vh)]" hideScrollBar={false}>
            {showLoadingRow ? (
              <div className="flex items-center justify-center gap-2 py-16 text-default-500">
                <Spinner size="md" />
                <span className="text-sm">Cargando datos de la nube…</span>
              </div>
            ) : !hasCloudGames ? (
              <p className="px-4 py-10 text-center text-sm text-default-500">No hay guardados en la nube todavía.</p>
            ) : (
              <Table
                aria-label="Guardados en la nube por juego"
                removeWrapper
                radius="none"
                classNames={{
                  base: "overflow-x-auto",
                  thead: "[&>tr]:first:rounded-none",
                }}>
                <TableHeader>
                  <TableColumn>Juego</TableColumn>
                  <TableColumn>Archivos</TableColumn>
                  <TableColumn>Tamaño</TableColumn>
                  <TableColumn>Última modif. (nube)</TableColumn>
                  <TableColumn>Acciones</TableColumn>
                </TableHeader>
                <TableBody>
                  {sortedGames.map((row, rowIndex) => {
                    const inLibrary = localGameIdsLower.has(row.gameId.toLowerCase());
                    const displayTitle = formatGameDisplayName(row.gameId);
                    const gameForMedia = gamesForCloudTableMedia[rowIndex]!;
                    const resolvedSteamAppId = resolvedSteamAppIds[gameForMedia.id];
                    return (
                      <TableRow key={row.gameId}>
                        <TableCell>
                          <div className="flex min-w-0 items-center gap-2.5">
                            <CloudDashboardGameCoverThumb
                              game={gameForMedia}
                              displayName={displayTitle}
                              mediaBySteamAppId={mediaBySteamAppId}
                              resolvedSteamAppId={resolvedSteamAppId}
                            />
                            <div className="flex min-w-0 flex-col gap-0.5">
                              <span className="truncate font-medium text-foreground">{displayTitle}</span>
                              <span className="truncate font-mono text-[11px] text-default-400">{row.gameId}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-default-600">{row.fileCount}</TableCell>
                        <TableCell className="whitespace-nowrap text-default-600">
                          {formatSize(row.totalSize)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-default-500">
                          {row.lastModified ? formatRelativeDate(row.lastModified) : "—"}
                        </TableCell>
                        <TableCell>
                          {inLibrary ? (
                            <span className="text-xs text-default-400">En biblioteca</span>
                          ) : (
                            <Button
                              size="sm"
                              variant="flat"
                              color="primary"
                              className="h-8 min-w-0 px-2 text-xs"
                              onPress={() => handleBringToDevice(row.gameId)}>
                              Traer a este equipo
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </ScrollShadow>
        </CardBody>
      </Card>
    </div>
  );
}

type CloudDashboardGameCoverThumbProps = {
  game: ConfiguredGame;
  displayName: string;
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null;
  resolvedSteamAppId: string | null | undefined;
};

/** Miniatura alineada con biblioteca/catálogo: {@link useGameMedia} + batch Steam. */
const CloudDashboardGameCoverThumb = memo(function CloudDashboardGameCoverThumb({
  game,
  displayName,
  mediaBySteamAppId,
  resolvedSteamAppId,
}: CloudDashboardGameCoverThumbProps) {
  const { displayImageUrl, isEffectivelyLoading, imgLoaded, imgError, handleImgLoad, handleImgError } = useGameMedia({
    game,
    resolvedSteamAppId: resolvedSteamAppId ?? null,
    mediaBySteamAppId,
    mediaFromBatch: true,
  });

  const showGamepad = !isEffectivelyLoading && (!displayImageUrl || imgError);
  const showLoadingOverlay = isEffectivelyLoading || (!!displayImageUrl && !imgLoaded && !imgError);

  return (
    <div className="relative h-9 w-[4.1rem] shrink-0 overflow-hidden rounded-md bg-default-100 ring-1 ring-inset ring-default-200/60 dark:ring-default-100/20">
      {showLoadingOverlay ? <Skeleton className="absolute inset-0 z-10 size-full rounded-md" /> : null}
      {displayImageUrl && !imgError ? (
        <img
          src={displayImageUrl}
          alt=""
          title={displayName}
          loading="lazy"
          decoding="async"
          draggable={false}
          className={`h-full w-full object-cover transition-opacity duration-200 ${imgLoaded ? "opacity-100" : "opacity-0"}`}
          onLoad={handleImgLoad}
          onError={handleImgError}
        />
      ) : null}
      {showGamepad ? (
        <div className="absolute inset-0 flex items-center justify-center text-default-400" aria-hidden>
          <Gamepad2 size={18} strokeWidth={1.75} />
        </div>
      ) : null}
    </div>
  );
});
