import { useMemo, useRef, useState } from "react";
import { Button, Spinner, Tooltip } from "@heroui/react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { BarChart3, RefreshCw } from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import { useNavigate } from "react-router-dom";
import { DownloadAllConflictModal } from "@features/games/DownloadAllConflictModal";
import { GameDrawer } from "@features/games/GameDrawer";
import { GameTorrentDrawer } from "@features/games/GameTorrentDrawer";
import { DownloadConflictModal } from "@features/games/DownloadConflictModal";
import { FullBackupConfirmModal } from "@features/games/FullBackupConfirmModal";
import { RestoreBackupModal } from "@features/games/RestoreBackupModal";
import { SyncPreviewModal } from "@features/games/SyncPreviewModal";
import { GamesFilters } from "@features/games/GamesFilters";
import { GamesList } from "@features/games/GamesList";
import { GamesPageHeader } from "@features/games/GamesPageHeader";
import { GamesStatsCompact } from "@features/games/GamesStatsCompact";
/* import { OperationErrorCard } from "@features/games/OperationErrorCard"; */
import { BulkActionConfirmModal } from "@features/games/BulkActionConfirmModal";
import { RemoveGameModal } from "@features/games/RemoveGameModal";
import { ScanModal } from "@features/games/ScanModal";
import { RestoreFromCloudWizardModal } from "@features/games/RestoreFromCloudWizardModal";
import { useGamesPage } from "@/hooks/useGamesPage";
import { useGameStats } from "@hooks/useGameStats";
import { scheduleConfigBackupToCloud } from "@services/tauri";
import { countGamesOverSizeThreshold } from "@utils/packageRecommendation";
import { createShareLink } from "@/services/tauri/share.service";
import { toastError, toastSuccess } from "@utils/toast";
import { useNavigationStore } from "@features/input/store";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";
import { prefetchProfileDrawer } from "@features/profile/profileDrawerPrefetch";
import { BigPictureGamesTopRail } from "@features/big-picture/BigPictureGamesTopRail";
import { useShellUiStore } from "@store/ShellUiStore";

export function GamesPage() {
  const prefersReducedMotion = useReducedMotion();
  const navigate = useNavigate();
  const pushLayer = useNavigationStore((state) => state.pushLayer);
  const popLayer = useNavigationStore((state) => state.popLayer);
  const {
    config,
    loading,
    error,
    refetch,
    hasSyncConfig,
    lastSyncAt,
    lastSyncGameId,
    cloudGames,
    totalCloudSize,
    lastSyncLoading,
    searchTerm,
    setSearchTerm,
    originFilter,
    setOriginFilter,
    debouncedSearchTerm,
    addModalOpen,
    setAddModalOpen,
    scanModalOpen,
    setScanModalOpen,
    setConfigureFromCloudGameId,
    restoreFromCloudGameId,
    handleOpenRestoreFromCloud,
    handleCloseRestoreFromCloud,
    openScanAssistForCloudRestore,
    linkCloudGameFolder,
    restoreWizardTriggerDownload,
    addModalInitial,
    setAddModalInitial,
    gameToRemove,
    setGameToRemove,
    downloadConflictGame,
    downloadConflicts,
    handleConfirmDownloadConflict,
    handleCloseDownloadConflict,
    downloadAllConflictGames,
    handleConfirmDownloadAllConflict,
    handleCloseDownloadAllConflict,
    syncing,
    downloading,
    fullBackupUploadingGameId,
    /* operationResult, */
    handleScanSelect,
    handleRemoveGame,
    handleConfirmRemove,
    handleSyncOne,
    handleDownloadOne,
    handleFullBackupUpload,
    syncPreviewGame,
    syncPreviewType,
    handleConfirmSyncPreview,
    handleCloseSyncPreview,
    gameToRestoreBackup,
    handleRestoreBackup,
    handleCloseRestoreBackup,
    bulkConfirm,
    handleConfirmBulkAction,
    handleCancelBulkAction,
    openSyncAllConfirm,
    openDownloadAllConfirm,
    handleOpenFolder,
    handleRefresh,
    refreshing,
    filteredGames,
    emptyFilterMessage,
    unsyncedGameIds,
    /* handleDismissOperationError, */
    /* handleRetryOperationError, */
  } = useGamesPage();

  const { statsByGameId } = useGameStats(!!config?.games?.length);

  const bigPictureConsole = useMemo(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("savecloud-big-picture"),
    []
  );

  const [gamesSummaryOpen, setGamesSummaryOpen] = useState(false);
  const gamesSummaryOpenRef = useRef(false);
  gamesSummaryOpenRef.current = gamesSummaryOpen;

  const [gameToEdit, setGameToEdit] = useState<ConfiguredGame | null>(null);
  const [gameForTorrent, setGameForTorrent] = useState<ConfiguredGame | null>(null);
  const [gameToFullBackupConfirm, setGameToFullBackupConfirm] = useState<ConfiguredGame | null>(null);

  const localGameIdsLower = useMemo(
    () => new Set((config?.games ?? []).map((g: ConfiguredGame) => g.id.toLowerCase())),
    [config?.games]
  );

  const gamesSummaryMotion = prefersReducedMotion
    ? ({ initial: false, animate: {}, exit: {}, transition: { duration: 0 } } as const)
    : ({
        initial: { opacity: 0, y: -10 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -6 },
        transition: { type: "spring" as const, stiffness: 380, damping: 30, mass: 0.85 },
      } as const);

  const layoutShiftTransition = prefersReducedMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 320, damping: 32, mass: 0.9 };

  useRegisterGlobalBack(() => {
    if (bigPictureConsole && gamesSummaryOpenRef.current) {
      setGamesSummaryOpen(false);
      return true;
    }
    switch (true) {
      case !!restoreFromCloudGameId:
        handleCloseRestoreFromCloud();
        return true;
      case scanModalOpen:
        setConfigureFromCloudGameId(null);
        setScanModalOpen(false);
        popLayer();
        return true;
      case addModalOpen:
        setAddModalOpen(false);
        return true;
      case !!gameToRemove:
        setGameToRemove(null);
        return true;
      case !!downloadConflictGame:
        handleCloseDownloadConflict();
        return true;
      case !!bulkConfirm:
        handleCancelBulkAction();
        return true;
      case downloadAllConflictGames.length > 0:
        handleCloseDownloadAllConflict();
        return true;
      case !!(syncPreviewGame && syncPreviewType):
        handleCloseSyncPreview();
        return true;
      case !!gameToFullBackupConfirm:
        setGameToFullBackupConfirm(null);
        return true;
      case !!gameToRestoreBackup:
        handleCloseRestoreBackup();
        return true;
      case !!gameToEdit:
        setGameToEdit(null);
        return true;
      case !!gameForTorrent:
        setGameForTorrent(null);
        return true;
      default:
        popLayer();
        return true;
    }
  });

  const handleShare = async (game: ConfiguredGame) => {
    try {
      const { shareUrl } = await createShareLink(game.id);
      await navigator.clipboard.writeText(shareUrl);
      toastSuccess("Link copiado", "El link para compartir este juego está en el portapapeles. Válido 7 días.");
    } catch (e) {
      toastError("No se pudo crear el link", e instanceof Error ? e.message : "Error inesperado");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
        <Spinner size="lg" color="primary" />
        <p className="text-default-500">Cargando configuración...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
        <p className="text-danger">{error}</p>
        <Button color="primary" startContent={<RefreshCw size={18} />} onPress={() => refetch?.()}>
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <LayoutGroup id="games-page-layout">
      <div className="flex flex-col gap-8">
        {/* Cabecera */}
        {bigPictureConsole ? (
          <>
            <BigPictureGamesTopRail
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              profileAvatar={config?.profileAvatar}
              profileFrame={config?.profileFrame}
              onOpenProfile={() => useShellUiStore.getState().requestProfileOpen()}
              onIntentOpenProfile={prefetchProfileDrawer}
            />

            <div className="mt-6 flex flex-col gap-4 sm:mt-8">
              <div className="flex flex-wrap items-center justify-between gap-3 gap-y-4">
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-semibold text-foreground md:text-[1.875rem]">Juegos configurados</h1>
                  {hasSyncConfig && unsyncedGameIds.length > 0 ? (
                    <span className="rounded-full bg-warning/20 px-3 py-1 text-sm font-medium text-warning">
                      {unsyncedGameIds.length} con cambios sin subir
                    </span>
                  ) : null}
                </div>
                <Tooltip
                  placement="bottom"
                  delay={350}
                  content={gamesSummaryOpen ? "Ocultar estadísticas" : "Ver estadísticas"}>
                  <Button
                    id="games-summary-toggle"
                    variant="bordered"
                    radius="lg"
                    size="lg"
                    className="h-11 min-h-11 shrink-0 border-default-300/70 font-semibold md:h-12 md:min-h-12"
                    startContent={<BarChart3 className="text-default-600" size={20} />}
                    aria-expanded={gamesSummaryOpen}
                    aria-controls="games-summary-panel"
                    onPress={() => setGamesSummaryOpen((o) => !o)}>
                    {gamesSummaryOpen ? "Ocultar estadísticas" : "Estadísticas"}
                  </Button>
                </Tooltip>
              </div>

              <AnimatePresence initial={false} mode="popLayout">
                {gamesSummaryOpen ? (
                  <motion.div
                    key="games-summary-panel"
                    layout="position"
                    id="games-summary-panel"
                    role="region"
                    aria-labelledby="games-summary-toggle"
                    {...gamesSummaryMotion}
                    className="origin-top overflow-hidden rounded-xl border border-default-300/55 bg-default-100/35 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:border-default-100/25 dark:bg-default-50/10"
                    style={{ willChange: prefersReducedMotion ? undefined : "opacity, transform" }}>
                    <motion.div
                      {...(prefersReducedMotion
                        ? { initial: false, animate: {}, transition: { duration: 0 } }
                        : {
                            initial: { opacity: 0, filter: "blur(4px)" },
                            animate: { opacity: 1, filter: "blur(0px)" },
                            transition: { delay: 0.035, duration: 0.22, ease: [0.16, 1, 0.3, 1] },
                          })}>
                      <GamesStatsCompact
                        gamesCount={config?.games?.length ?? 0}
                        lastSyncAt={lastSyncAt}
                        lastSyncGameId={lastSyncGameId}
                        lastSyncLoading={hasSyncConfig && lastSyncLoading}
                        hasSyncConfig={hasSyncConfig}
                        cloudGames={cloudGames}
                        totalCloudSize={totalCloudSize}
                        localGameIdsLower={localGameIdsLower}
                        onRestoreFromCloud={handleOpenRestoreFromCloud}
                      />
                    </motion.div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-semibold text-foreground">Juegos configurados</h1>
                {hasSyncConfig && unsyncedGameIds.length > 0 ? (
                  <span className="rounded-full bg-warning/20 px-3 py-1 text-sm font-medium text-warning">
                    {unsyncedGameIds.length} con cambios sin subir
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:justify-between md:gap-4">
                  <div className="min-w-0 flex-1">
                    <GamesPageHeader
                      hasSyncConfig={hasSyncConfig}
                      gamesCount={config?.games?.length ?? 0}
                      syncing={syncing}
                      downloading={downloading}
                      onScanPress={() => {
                        pushLayer("scan-modal", "scan-search-input");
                        setScanModalOpen(true);
                      }}
                      onAddPress={() => {
                        setAddModalInitial({ paths: [], suggestedId: "" });
                        setAddModalOpen(true);
                      }}
                      onDownloadAllPress={openDownloadAllConfirm}
                      onSyncAllPress={openSyncAllConfirm}
                      onRefreshPress={handleRefresh}
                      onSaveGraphPress={() => navigate("/graph")}
                      isRefreshing={refreshing}
                    />
                  </div>
                </div>
              </div>

              <div className="w-full xl:w-auto">
                <GamesStatsCompact
                  gamesCount={config?.games?.length ?? 0}
                  lastSyncAt={lastSyncAt}
                  lastSyncGameId={lastSyncGameId}
                  lastSyncLoading={hasSyncConfig && lastSyncLoading}
                  hasSyncConfig={hasSyncConfig}
                  cloudGames={cloudGames}
                  totalCloudSize={totalCloudSize}
                  localGameIdsLower={localGameIdsLower}
                  onRestoreFromCloud={handleOpenRestoreFromCloud}
                />
              </div>
            </div>
          </div>
        )}
        <GameDrawer
          isOpen={addModalOpen}
          onClose={() => setAddModalOpen(false)}
          onSuccess={() => {
            scheduleConfigBackupToCloud();
            handleRefresh?.();
          }}
          mode="add"
          initialPaths={addModalInitial.paths}
          suggestedId={addModalInitial.suggestedId}
        />
        {restoreFromCloudGameId && (
          <RestoreFromCloudWizardModal
            gameId={restoreFromCloudGameId}
            isOpen={!!restoreFromCloudGameId}
            onClose={handleCloseRestoreFromCloud}
            onLinkFolder={(folderPath) => linkCloudGameFolder(restoreFromCloudGameId, folderPath)}
            onRequestScanAssist={() => {
              const gid = restoreFromCloudGameId;
              if (!gid) return;
              pushLayer("scan-modal", "scan-search-input");
              openScanAssistForCloudRestore(gid);
            }}
            onDownloadNow={() => {
              const gid = restoreFromCloudGameId;
              if (!gid) return;
              handleCloseRestoreFromCloud();
              restoreWizardTriggerDownload(gid);
            }}
          />
        )}
        <ScanModal
          isOpen={scanModalOpen}
          onClose={() => {
            setConfigureFromCloudGameId(null);
            setScanModalOpen(false);
            popLayer();
          }}
          onSelectCandidate={handleScanSelect}
          configuredGames={config?.games ?? []}
        />
        <RemoveGameModal
          isOpen={!!gameToRemove}
          onClose={() => setGameToRemove(null)}
          game={gameToRemove}
          onConfirm={handleConfirmRemove}
        />
        <DownloadConflictModal
          isOpen={!!downloadConflictGame}
          onClose={handleCloseDownloadConflict}
          gameId={downloadConflictGame?.id ?? ""}
          conflicts={downloadConflicts}
          onConfirm={handleConfirmDownloadConflict}
          isLoading={!!downloading && downloading === downloadConflictGame?.id}
        />
        <BulkActionConfirmModal
          isOpen={!!bulkConfirm}
          type={bulkConfirm?.type ?? "sync"}
          count={bulkConfirm?.count ?? 0}
          gamesOverSizeThreshold={
            bulkConfirm?.type === "sync" && config?.games?.length
              ? countGamesOverSizeThreshold(
                  config.games.map((g: ConfiguredGame) => g.id),
                  statsByGameId as unknown as Map<string, { localSizeBytes: number }>
                )
              : 0
          }
          onConfirm={handleConfirmBulkAction}
          onClose={handleCancelBulkAction}
        />
        <DownloadAllConflictModal
          isOpen={downloadAllConflictGames.length > 0}
          onClose={handleCloseDownloadAllConflict}
          gamesWithConflicts={downloadAllConflictGames}
          onConfirm={handleConfirmDownloadAllConflict}
          isLoading={downloading === "all"}
        />
        <SyncPreviewModal
          isOpen={!!syncPreviewGame && !!syncPreviewType}
          onClose={handleCloseSyncPreview}
          type={syncPreviewType ?? "upload"}
          gameId={syncPreviewGame?.id ?? ""}
          onConfirm={handleConfirmSyncPreview}
          onFullBackupInstead={
            syncPreviewType === "upload" && syncPreviewGame
              ? () => {
                  handleCloseSyncPreview();
                  setGameToFullBackupConfirm(syncPreviewGame);
                }
              : undefined
          }
          isLoading={
            (!!syncing && syncing === syncPreviewGame?.id) || (!!downloading && downloading === syncPreviewGame?.id)
          }
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
          onClose={handleCloseRestoreBackup}
          game={gameToRestoreBackup}
          onSuccess={handleRefresh}
          hasCloudIntegration={hasSyncConfig}
          onDownloadFromCloud={
            gameToRestoreBackup && hasSyncConfig
              ? () => {
                  void handleDownloadOne(gameToRestoreBackup);
                }
              : undefined
          }
          isDownloadingFromCloud={!!(gameToRestoreBackup && downloading === gameToRestoreBackup.id)}
        />
        <GameDrawer
          isOpen={!!gameToEdit}
          onClose={() => setGameToEdit(null)}
          onSuccess={() => {
            scheduleConfigBackupToCloud();
            handleRefresh();
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
        <motion.div
          layout={bigPictureConsole ? "position" : false}
          transition={{ layout: layoutShiftTransition }}
          className="flex flex-col gap-8">
          {/* Filtros de la lista */}
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-default-500">
              {bigPictureConsole ? "Filtrar por origen" : "Buscar y filtrar"}
            </h2>
            <GamesFilters
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              originFilter={originFilter}
              onOriginFilterChange={setOriginFilter}
              omitSearch={bigPictureConsole}
            />
          </section>
          {/* Lista de juegos */}
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-default-500">Lista de juegos</h2>
            <GamesList
              games={filteredGames}
              animationKey={`${originFilter}|${debouncedSearchTerm}`}
              emptyFilterMessage={emptyFilterMessage}
              unsyncedGameIds={unsyncedGameIds}
              onEmptyScanPress={() => setScanModalOpen(true)}
              onEmptyAddPress={() => {
                setAddModalInitial({ paths: [], suggestedId: "" });
                setAddModalOpen(true);
              }}
              onRemove={handleRemoveGame}
              onSync={hasSyncConfig ? handleSyncOne : undefined}
              syncingId={syncing}
              downloadingId={downloading}
              onOpenFolder={handleOpenFolder}
              onRecoverFromCloud={handleRestoreBackup}
              onFullBackupUpload={hasSyncConfig ? setGameToFullBackupConfirm : undefined}
              fullBackupUploadingGameId={fullBackupUploadingGameId}
              onEdit={setGameToEdit}
              onTorrent={setGameForTorrent}
              onShare={hasSyncConfig ? handleShare : undefined}
              hasSyncConfig={hasSyncConfig}
            />
          </section>
        </motion.div>

        {/* operationResult && operationResult.result.errors.length > 0 && (
        <OperationErrorCard
          operationResult={operationResult}
          onDismiss={handleDismissOperationError}
          onRetry={handleRetryOperationError}
        />
      )} */}
      </div>
    </LayoutGroup>
  );
}
