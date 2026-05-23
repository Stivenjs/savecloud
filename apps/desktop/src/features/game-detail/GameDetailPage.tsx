import {
  addTransitionType,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
} from "react";
import { pickCandidate, sourceCandidateKey } from "@utils/sourceMatch";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";

import { Button, Select, SelectItem, Spinner, Tab, Tabs, Skeleton } from "@heroui/react";
import { ArrowLeft, Cpu, Gamepad2, LayoutList, ScrollText } from "lucide-react";
import { formatGameDisplayName } from "@utils/gameImage";
import {
  launchGame,
  openSaveFolder,
  removeGame,
  scheduleConfigBackupToCloud,
  syncCheckDownloadConflicts,
} from "@services/tauri";
import type { DownloadConflict } from "@services/tauri";
import { sourcesFindMatchForGame, startSourceDownload } from "@services/tauri";
import { createShareLink } from "@/services/tauri/share.service";
import { toastError, toastSuccess } from "@utils/toast";
import { CONFIG_QUERY_KEY } from "@hooks/useConfig";
import { LAST_SYNC_QUERY_KEY } from "@hooks/useLastSyncInfo";
import { LARGE_GAME_BLOCK_SIZE_BYTES } from "@utils/packageRecommendation";
import { GameDrawer } from "@features/games/GameDrawer";
import { GameTorrentDrawer } from "@features/games/GameTorrentDrawer";
import { FullBackupConfirmModal } from "@features/games/FullBackupConfirmModal";
import { RestoreBackupModal } from "@features/games/RestoreBackupModal";
import { SyncPreviewModal } from "@features/games/SyncPreviewModal";
import { DownloadConflictModal } from "@features/games/DownloadConflictModal";
import { useGameDetail } from "@/hooks/useGameDetail";
import { useGameDetailCloudActions } from "@/hooks/useGameDetailCloudActions";
import { GameDetailHero } from "@features/game-detail/GameDetailHero";
import { GameDetailActionStrip } from "@features/game-detail/GameDetailActionStrip";
import { GameDetailSyncSetupBanner } from "@features/game-detail/GameDetailSyncSetupBanner";
import { InstallModal } from "@features/steam-catalog/components/InstallModal";
import { useDisclosure } from "@heroui/react";

import {
  GameDetailLocalSummary,
  GameDetailRequirementsPanel,
  GameDetailSteamDetailsPanel,
  GameDetailSummaryPanel,
  hasSteamRequirements,
} from "@features/game-detail/GameDetailInfo";
import type { ConfiguredGame } from "@app-types/config";
import type { SteamAppdetailsMediaResult } from "@services/tauri";

export function GameDetailPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { handleSync, handleDownload, handleFullBackupUpload, isSyncing, isDownloading, fullBackupUploadingGameId } =
    useGameDetailCloudActions();
  const {
    gameId,
    game,
    steamAppId,
    steamDetails,

    stats,
    isGameRunning,
    mediaUrls,
    libraryHeroFallbackUrl,
    isLoading,
    hasSyncConfig,
    isSteamCatalogOnly,
    backToPath,
    catalogDisplayName,
    catalogListingName,
    videoUrl,
  } = useGameDetail();
  const [activeTab, setActiveTab] = useState("summary");
  const tabsShellRef = useRef<HTMLDivElement>(null);
  const [gameToEdit, setGameToEdit] = useState<ConfiguredGame | null>(null);
  const [gameForTorrent, setGameForTorrent] = useState<ConfiguredGame | null>(null);
  const [gameToFullBackupConfirm, setGameToFullBackupConfirm] = useState<ConfiguredGame | null>(null);
  const [gameToRestoreBackup, setGameToRestoreBackup] = useState<ConfiguredGame | null>(null);
  const [downloadPreviewGameId, setDownloadPreviewGameId] = useState<string | null>(null);
  const [downloadConflictState, setDownloadConflictState] = useState<{
    gameId: string;
    conflicts: DownloadConflict[];
  } | null>(null);
  const {
    isOpen: isInstallModalOpen,
    onOpen: onInstallModalOpen,
    onOpenChange: onInstallModalOpenChange,
  } = useDisclosure();
  const [installingFromSource, setInstallingFromSource] = useState<{
    size?: string | null;
    protocols?: string[];
  } | null>(null);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  const goBackFromDetail = useCallback(() => {
    if (backToPath) {
      navigate(backToPath);
    } else {
      navigate(-1);
    }
  }, [navigate, backToPath]);

  const handleBackWithTransition = useCallback(() => {
    startTransition(() => {
      addTransitionType("game-detail");
      goBackFromDetail();
    });
  }, [goBackFromDetail]);

  const requestDownloadFromCloud = useCallback(async (target: ConfiguredGame) => {
    try {
      const { conflicts } = await syncCheckDownloadConflicts(target.id);
      if (conflicts.length > 0) {
        setDownloadConflictState({ gameId: target.id, conflicts });
        return;
      }
      setDownloadPreviewGameId(target.id);
    } catch (e) {
      toastError("No se pudo preparar la descarga", e instanceof Error ? e.message : "Error inesperado");
    }
  }, []);

  useRegisterGlobalBack(() => {
    switch (true) {
      case !!downloadPreviewGameId:
        setDownloadPreviewGameId(null);
        return true;
      case !!downloadConflictState:
        setDownloadConflictState(null);
        return true;
      case !!gameToEdit:
        setGameToEdit(null);
        return true;
      case !!gameForTorrent:
        setGameForTorrent(null);
        return true;
      case !!gameToFullBackupConfirm:
        setGameToFullBackupConfirm(null);
        return true;
      case !!gameToRestoreBackup:
        setGameToRestoreBackup(null);
        return true;
      default:
        handleBackWithTransition();
        return true;
    }
  });

  useEffect(() => {
    setActiveTab("summary");
  }, [gameId]);

  const handleTabsSelectionChange = useCallback((key: React.Key) => {
    setActiveTab(String(key));
    requestAnimationFrame(() => {
      tabsShellRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const displayName = steamDetails?.name || formatGameDisplayName(gameId);

  const handleOpenFolder = useCallback(async (g: ConfiguredGame) => {
    try {
      await openSaveFolder(g.id);
    } catch (e) {
      toastError("Error al abrir carpeta", e instanceof Error ? e.message : "Error inesperado");
    }
  }, []);

  const handlePlay = useCallback(async (g: ConfiguredGame) => {
    try {
      await launchGame(g.id);
    } catch (e) {
      toastError("No se pudo abrir el juego", e instanceof Error ? e.message : "Error inesperado");
    }
  }, []);

  const handleShare = useCallback(async (g: ConfiguredGame) => {
    try {
      const { shareUrl } = await createShareLink(g.id);
      await navigator.clipboard.writeText(shareUrl);
      toastSuccess("Link copiado", "Válido por 7 días.");
    } catch (e) {
      toastError("No se pudo crear el link", e instanceof Error ? e.message : "Error inesperado");
    }
  }, []);

  const handleOpenGraph = useCallback(
    (g: ConfiguredGame) => {
      navigate(`/games/${g.id}/graph`);
    },
    [navigate]
  );

  const handleRemove = useCallback(
    async (g: ConfiguredGame) => {
      try {
        await removeGame(g.id);
        toastSuccess("Eliminado", `${formatGameDisplayName(g.id)} eliminado.`);
        await Promise.all([
          queryClient.refetchQueries({ queryKey: CONFIG_QUERY_KEY }),
          queryClient.refetchQueries({ queryKey: LAST_SYNC_QUERY_KEY }),
        ]);
        navigate("/");
      } catch (e) {
        toastError("Error al eliminar", e instanceof Error ? e.message : "Error inesperado");
      }
    },
    [navigate, queryClient]
  );

  const showRequirementsTab = steamDetails ? hasSteamRequirements(steamDetails) : false;
  const isUploadTooLarge = (stats?.localSizeBytes ?? 0) >= LARGE_GAME_BLOCK_SIZE_BYTES;
  const nameForMatch = useMemo(() => {
    if (isSteamCatalogOnly) {
      const catalogName = (catalogDisplayName ?? catalogListingName)?.trim();
      return catalogName || null;
    }
    const steamName = steamDetails?.name?.trim();
    if (steamName) return steamName;
    return formatGameDisplayName(gameId);
  }, [isSteamCatalogOnly, catalogDisplayName, catalogListingName, steamDetails?.name, gameId]);

  const { data: sourceCandidates, isPending: isMatchingPending } = useQuery({
    queryKey: ["sources-match-detail", gameId, nameForMatch],
    queryFn: () => sourcesFindMatchForGame(nameForMatch!),
    enabled: !!nameForMatch,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const [selectedSourceKey, setSelectedSourceKey] = useState<string | null>(null);

  // Derivar el "best" explícitamente basado en el arreglo
  const bestSourceMatch = sourceCandidates && sourceCandidates.length > 0 ? sourceCandidates[0] : undefined;

  useEffect(() => {
    const list = sourceCandidates ?? [];
    if (!bestSourceMatch || list.length === 0) {
      setSelectedSourceKey(null);
      return;
    }
    setSelectedSourceKey((prev) => {
      if (prev && list.some((c) => sourceCandidateKey(c) === prev)) {
        return prev;
      }
      return sourceCandidateKey(bestSourceMatch);
    });
  }, [sourceCandidates, bestSourceMatch]);

  const handleInstallFromSources = useCallback(async () => {
    const chosen = pickCandidate(sourceCandidates, selectedSourceKey);
    if (!chosen) return;

    setInstallingFromSource({ size: chosen.file_size, protocols: chosen.protocols });
    onInstallModalOpen();
  }, [sourceCandidates, selectedSourceKey, onInstallModalOpen]);

  const installModalMediaBySteamAppId = useMemo((): Record<string, SteamAppdetailsMediaResult> | null => {
    if (!steamAppId || !steamDetails) return null;
    return {
      [steamAppId]: {
        mediaUrls: steamDetails.media.mediaUrls,
        videoUrl: steamDetails.media.videoUrl,
        genres: steamDetails.genres,
        name: steamDetails.name,
        capsuleImage: steamDetails.media.capsuleImage,
      },
    };
  }, [steamAppId, steamDetails]);

  const handleConfirmInstall = useCallback(
    async (selectedPath: string) => {
      const chosen = pickCandidate(sourceCandidates, selectedSourceKey);
      if (!chosen) return;

      try {
        await startSourceDownload({
          sourceId: chosen.source_id,
          itemId: chosen.item_id,
          destinationDir: selectedPath.trim(),
          preferredProtocol: null,
        });
        toastSuccess("Descarga iniciada", `Instalacion iniciada para ${displayName}.`);
      } catch (e) {
        toastError("No se pudo iniciar", e instanceof Error ? e.message : "Error inesperado");
      }
    },
    [sourceCandidates, selectedSourceKey, displayName]
  );

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
        <Spinner size="lg" color="primary" />
        <p className="text-default-500">Cargando detalles del juego...</p>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
        <Gamepad2 size={56} className="text-default-400" strokeWidth={1.2} />
        <p className="text-lg font-medium text-default-600">Juego no encontrado</p>
        <p className="text-sm text-default-400">
          El juego <span className="font-mono text-default-500">{gameId}</span> no está configurado.
        </p>
        <Button
          color="primary"
          variant="bordered"
          startContent={<ArrowLeft size={18} />}
          onPress={handleBackWithTransition}>
          Volver
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-4">
      <GameDetailHero
        mediaUrls={mediaUrls}
        headerImage={steamDetails?.headerImage}
        libraryHeroFallbackUrl={libraryHeroFallbackUrl}
        customImageUrl={game.imageUrl}
        videoUrl={videoUrl}
        gameName={displayName}
        editionLabel={game.editionLabel}
        gameId={gameId}
        isLoading={isLoading}
        onBack={handleBackWithTransition}
      />

      {!hasSyncConfig ? <GameDetailSyncSetupBanner /> : null}

      <GameDetailActionStrip
        game={game}
        stats={stats}
        isGameRunning={isGameRunning}
        isUploadTooLarge={isUploadTooLarge}
        isSyncing={isSyncing}
        isDownloading={isDownloading}
        isFullBackupUploading={fullBackupUploadingGameId === game.id}
        onPlay={isSteamCatalogOnly ? undefined : handlePlay}
        onOpenGraph={isSteamCatalogOnly ? undefined : handleOpenGraph}
        onOpenFolder={isSteamCatalogOnly ? undefined : handleOpenFolder}
        onEdit={isSteamCatalogOnly ? undefined : setGameToEdit}
        onTorrent={isSteamCatalogOnly ? undefined : setGameForTorrent}
        onSync={!isSteamCatalogOnly && hasSyncConfig ? handleSync : undefined}
        onRecoverFromCloud={isSteamCatalogOnly ? undefined : (g) => setGameToRestoreBackup(g)}
        onShare={!isSteamCatalogOnly && hasSyncConfig ? handleShare : undefined}
        onRemove={isSteamCatalogOnly ? undefined : handleRemove}
        onFullBackupUpload={!isSteamCatalogOnly && hasSyncConfig ? setGameToFullBackupConfirm : undefined}
      />

      {isMatchingPending ? (
        <section className="rounded-xl border border-default-200/50 bg-default-50/50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
            <div className="min-w-0 flex-1 space-y-3 w-full">
              {/* Título falso */}
              <Skeleton className="h-5 w-48 rounded-lg" />
              {/* Selector falso */}
              <Skeleton className="h-12 w-full max-w-md rounded-lg" />
            </div>
            {/* Botón falso */}
            <Skeleton className="h-10 w-full sm:w-24 rounded-lg" />
          </div>
        </section>
      ) : bestSourceMatch && sourceCandidates ? (
        <section className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-semibold">Disponibilidad en tus fuentes</p>
              {sourceCandidates.length > 1 ? (
                <Select
                  label="Elegir fuente"
                  placeholder="Selecciona una coincidencia"
                  size="sm"
                  variant="bordered"
                  className="mt-1 max-w-md"
                  selectionMode="single"
                  selectedKeys={new Set([selectedSourceKey ?? sourceCandidateKey(bestSourceMatch)])}
                  onSelectionChange={(keys) => {
                    const next = [...keys][0];
                    if (next !== undefined) setSelectedSourceKey(String(next));
                  }}>
                  {sourceCandidates.map((c) => (
                    <SelectItem
                      key={sourceCandidateKey(c)}
                      textValue={`${c.source_name} ${c.item_title} ${Math.round(c.score * 100)}`}>
                      {c.source_name} — {c.item_title} ({Math.round(c.score * 100)}%)
                    </SelectItem>
                  ))}
                </Select>
              ) : (
                <p className="text-xs text-default-500">
                  Coincidencia: {bestSourceMatch.item_title} ({bestSourceMatch.source_name})
                </p>
              )}
            </div>
            <Button color="primary" onPress={() => void handleInstallFromSources()}>
              Instalar
            </Button>
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-default-200/70 bg-default-100/80 p-4">
          <p className="text-sm text-default-500">No disponible en tus fuentes.</p>
        </section>
      )}

      <GameDrawer
        isOpen={!!gameToEdit}
        onClose={() => setGameToEdit(null)}
        onSuccess={() => {
          scheduleConfigBackupToCloud();
          void queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
          setGameToEdit(null);
        }}
        mode="edit"
        game={gameToEdit}
      />
      <GameTorrentDrawer
        isOpen={!!gameForTorrent}
        onClose={() => setGameForTorrent(null)}
        game={gameForTorrent}
        cloudEnabled={hasSyncConfig}
      />
      <FullBackupConfirmModal
        isOpen={!!gameToFullBackupConfirm}
        onClose={() => setGameToFullBackupConfirm(null)}
        game={gameToFullBackupConfirm}
        onConfirm={async () => {
          if (gameToFullBackupConfirm) {
            await handleFullBackupUpload(gameToFullBackupConfirm);
          }
        }}
      />
      <RestoreBackupModal
        isOpen={!!gameToRestoreBackup}
        onClose={() => setGameToRestoreBackup(null)}
        game={gameToRestoreBackup}
        hasCloudIntegration={hasSyncConfig}
        onDownloadFromCloud={
          gameToRestoreBackup && hasSyncConfig
            ? () => {
                void requestDownloadFromCloud(gameToRestoreBackup);
              }
            : undefined
        }
        isDownloadingFromCloud={Boolean(isDownloading && gameToRestoreBackup && game?.id === gameToRestoreBackup.id)}
        onSuccess={() => {
          void queryClient.invalidateQueries({ queryKey: ["game-stats"] });
          void queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
        }}
      />
      <SyncPreviewModal
        isOpen={!!downloadPreviewGameId}
        onClose={() => setDownloadPreviewGameId(null)}
        type="download"
        gameId={downloadPreviewGameId ?? ""}
        onConfirm={async () => {
          if (!downloadPreviewGameId || !game || game.id !== downloadPreviewGameId) return;
          await handleDownload(game);
          setDownloadPreviewGameId(null);
        }}
        isLoading={isDownloading && !!downloadPreviewGameId && game?.id === downloadPreviewGameId}
      />
      <DownloadConflictModal
        isOpen={!!downloadConflictState && downloadConflictState.conflicts.length > 0}
        onClose={() => setDownloadConflictState(null)}
        gameId={downloadConflictState?.gameId ?? ""}
        conflicts={downloadConflictState?.conflicts ?? []}
        onConfirm={async () => {
          if (!downloadConflictState || !game || game.id !== downloadConflictState.gameId) return;
          setDownloadConflictState(null);
          await handleDownload(game);
        }}
        isLoading={isDownloading && !!downloadConflictState && game?.id === downloadConflictState.gameId}
      />

      {steamDetails ? (
        <div ref={tabsShellRef} className="scroll-mt-6">
          <Tabs
            selectedKey={activeTab}
            onSelectionChange={handleTabsSelectionChange}
            variant="underlined"
            color="primary"
            size="lg"
            classNames={{
              base: "w-full",
              tabList:
                "sticky top-0 z-20 w-full min-h-[3.25rem] flex-nowrap gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-default-200/80 bg-background/85 px-0 pt-1 backdrop-blur-md [scrollbar-width:thin] supports-[backdrop-filter]:bg-background/75 dark:border-default-100/25 dark:bg-background/70",
              tab: "min-w-[9rem] shrink-0 gap-2 px-3 py-2 text-default-600 data-[selected=true]:font-semibold data-[selected=true]:text-foreground sm:min-w-0 sm:flex-1 sm:justify-center",
              tabContent: "group flex items-center gap-2",
              cursor: "bg-primary",
              panel: "min-h-[16rem] px-0 pb-2 pt-8 sm:min-h-[18rem] sm:pt-10",
            }}
            aria-label="Secciones del juego">
            <Tab
              key="summary"
              title={
                <span className="flex items-center gap-2">
                  <LayoutList size={18} className="text-default-400 group-data-[selected=true]:text-primary" />
                  <span>Resumen</span>
                </span>
              }>
              <GameDetailSummaryPanel details={steamDetails} />
            </Tab>
            <Tab
              key="details"
              title={
                <span className="flex items-center gap-2">
                  <ScrollText size={18} className="text-default-400 group-data-[selected=true]:text-primary" />
                  <span>Detalles</span>
                </span>
              }>
              <GameDetailSteamDetailsPanel details={steamDetails} />
            </Tab>
            {showRequirementsTab ? (
              <Tab
                key="requirements"
                title={
                  <span className="flex items-center gap-2">
                    <Cpu size={18} className="text-default-400 group-data-[selected=true]:text-primary" />
                    <span>Requisitos</span>
                  </span>
                }>
                <GameDetailRequirementsPanel details={steamDetails} />
              </Tab>
            ) : null}
          </Tabs>
        </div>
      ) : (
        <section className="rounded-2xl border border-default-200/60 bg-content1 px-5 py-6 shadow-sm dark:border-default-100/20 dark:bg-content1/80 sm:px-7 sm:py-8">
          <h2 className="mb-6 text-lg font-semibold tracking-tight text-foreground">Resumen</h2>
          <GameDetailLocalSummary game={game} />
        </section>
      )}
      {installingFromSource && game ? (
        <InstallModal
          isOpen={isInstallModalOpen}
          onOpenChange={onInstallModalOpenChange}
          gameName={displayName}
          gameSizeStr={installingFromSource.size}
          protocols={installingFromSource.protocols}
          game={game}
          mediaBySteamAppId={installModalMediaBySteamAppId}
          onConfirm={handleConfirmInstall}
        />
      ) : null}
    </div>
  );
}
