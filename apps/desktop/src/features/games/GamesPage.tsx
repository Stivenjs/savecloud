import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { Button } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import { useNavigate } from "react-router-dom";
import { GamesFilters } from "@features/games/GamesFilters";
import { GamesList } from "@features/games/GamesList";
import { GamesPageHeader } from "@features/games/GamesPageHeader";
import { GamesPageSkeleton } from "@features/games/GamesPageSkeleton";

const DownloadAllConflictModalLazy = lazy(() =>
  import("@features/games/DownloadAllConflictModal").then((m) => ({ default: m.DownloadAllConflictModal }))
);
const GameDrawerLazy = lazy(() => import("@features/games/GameDrawer").then((m) => ({ default: m.GameDrawer })));
const GameTorrentDrawerLazy = lazy(() =>
  import("@features/games/GameTorrentDrawer").then((m) => ({ default: m.GameTorrentDrawer }))
);
const DownloadConflictModalLazy = lazy(() =>
  import("@features/games/DownloadConflictModal").then((m) => ({ default: m.DownloadConflictModal }))
);
const FullBackupConfirmModalLazy = lazy(() =>
  import("@features/games/FullBackupConfirmModal").then((m) => ({ default: m.FullBackupConfirmModal }))
);
const RestoreBackupModalLazy = lazy(() =>
  import("@features/games/RestoreBackupModal").then((m) => ({ default: m.RestoreBackupModal }))
);
const SyncPreviewModalLazy = lazy(() =>
  import("@features/games/SyncPreviewModal").then((m) => ({ default: m.SyncPreviewModal }))
);
const BulkActionConfirmModalLazy = lazy(() =>
  import("@features/games/BulkActionConfirmModal").then((m) => ({ default: m.BulkActionConfirmModal }))
);
const RemoveGameModalLazy = lazy(() =>
  import("@features/games/RemoveGameModal").then((m) => ({ default: m.RemoveGameModal }))
);
const ScanModalLazy = lazy(() => import("@features/games/ScanModal").then((m) => ({ default: m.ScanModal })));
const RestoreFromCloudWizardModalLazy = lazy(() =>
  import("@features/games/RestoreFromCloudWizardModal").then((m) => ({ default: m.RestoreFromCloudWizardModal }))
);
const TrashModalLazy = lazy(() => import("@features/games/TrashModal").then((m) => ({ default: m.TrashModal })));
import { useGamesPage } from "@/hooks/useGamesPage";
import { useGameStats } from "@hooks/useGameStats";
import { scheduleConfigBackupToCloud } from "@services/tauri";
import { countGamesOverSizeThreshold } from "@utils/packageRecommendation";
import { createShareLink } from "@/services/tauri/share.service";
import { toastError, toastSuccess } from "@utils/toast";
import { useNavigationStore } from "@features/input/store";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";
import { useShellUiStore } from "@store/ShellUiStore";
import { useScrollRestoration } from "@hooks/useScrollRestoration";

export function GamesPage() {
  const { t } = useTranslation();
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
    searchTerm,
    setSearchTerm,
    originFilter,
    setOriginFilter,
    debouncedSearchTerm,
    addModalOpen,
    setAddModalOpen,
    scanModalOpen,
    setScanModalOpen,
    trashModalOpen,
    setTrashModalOpen,
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
    handleConfirmClearCloudSaves,
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

  useEffect(() => {
    if (!bigPictureConsole) return;
    const reg = useShellUiStore.getState().registerGamesBpSearchValueSetter;
    const put = useShellUiStore.getState().setGamesBpSearchTerm;
    reg(setSearchTerm);
    put(searchTerm);
    return () => {
      reg(null);
      put("");
    };
  }, [bigPictureConsole, setSearchTerm]);

  useEffect(() => {
    if (bigPictureConsole) useShellUiStore.getState().setGamesBpSearchTerm(searchTerm);
  }, [bigPictureConsole, searchTerm]);

  const openRestoreReq = useShellUiStore((s) => s.openRestoreFromCloudRequest);
  const prevRestoreReqRef = useRef(0);

  useEffect(() => {
    if (openRestoreReq <= prevRestoreReqRef.current) return;
    prevRestoreReqRef.current = openRestoreReq;
    const gid = useShellUiStore.getState().openRestoreFromCloudGameId?.trim();
    useShellUiStore.setState({ openRestoreFromCloudGameId: null });
    if (gid) handleOpenRestoreFromCloud(gid);
  }, [openRestoreReq, handleOpenRestoreFromCloud]);

  const [gameToEdit, setGameToEdit] = useState<ConfiguredGame | null>(null);
  const [gameForTorrent, setGameForTorrent] = useState<ConfiguredGame | null>(null);
  const [gameToFullBackupConfirm, setGameToFullBackupConfirm] = useState<ConfiguredGame | null>(null);

  const layoutShiftTransition = prefersReducedMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 320, damping: 32, mass: 0.9 };

  useRegisterGlobalBack(() => {
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
      toastSuccess(t("library.shareLink.copiedTitle"), t("library.shareLink.copiedDesc"));
    } catch (e) {
      toastError(
        t("library.shareLink.errorTitle"),
        e instanceof Error ? e.message : t("library.shareLink.unexpectedError")
      );
    }
  };

  useScrollRestoration("library", !loading && filteredGames.length > 0, {
    resetOnDeps: [debouncedSearchTerm, originFilter],
  });

  const initialFocusSetRef = useRef(false);
  useEffect(() => {
    if (loading || filteredGames.length === 0) return;
    if (!initialFocusSetRef.current) {
      initialFocusSetRef.current = true;
      const firstCardId = `game-card-${filteredGames[0].id}`;
      const timer = setTimeout(() => {
        useNavigationStore.getState().setFocus(firstCardId);
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [loading, filteredGames]);

  if (loading) {
    return <GamesPageSkeleton />;
  }

  if (error) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
        <p className="text-danger">{error}</p>
        <Button color="primary" startContent={<RefreshCw size={18} />} onPress={() => refetch?.()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  return (
    <LayoutGroup id="games-page-layout">
      <div className={`flex flex-col ${bigPictureConsole ? "gap-5" : "gap-0"}`}>
        {/* Cabecera */}
        {bigPictureConsole ? (
          <>
            <div className="mt-4 flex flex-col gap-3 sm:mt-6">
              <div className="flex flex-wrap items-center gap-3 gap-y-4">
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-semibold text-foreground md:text-[1.875rem]">
                    {t("library.configuredGames")}
                  </h1>
                  {hasSyncConfig && unsyncedGameIds.length > 0 ? (
                    <span className="rounded-full bg-warning/20 px-3 py-1 text-sm font-medium text-warning">
                      {t("library.unsyncedChanges", { count: unsyncedGameIds.length })}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <div className="flex flex-col gap-4">
                <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
                  <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground">
                    {t("library.configuredGames")}
                  </h1>
                  {hasSyncConfig && unsyncedGameIds.length > 0 ? (
                    <span className="rounded-full bg-warning/20 px-3 py-1 text-sm font-medium text-warning">
                      {t("library.unsyncedChanges", { count: unsyncedGameIds.length })}
                    </span>
                  ) : null}
                </div>
                <div className="flex w-full min-w-0 max-w-full justify-start pr-2">
                  <GamesPageHeader
                    density="unified"
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
                    onTrashPress={() => setTrashModalOpen(true)}
                    isRefreshing={refreshing}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
        {addModalOpen && (
          <Suspense fallback={null}>
            <GameDrawerLazy
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
          </Suspense>
        )}
        {restoreFromCloudGameId && (
          <Suspense fallback={null}>
            <RestoreFromCloudWizardModalLazy
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
          </Suspense>
        )}
        {scanModalOpen && (
          <Suspense fallback={null}>
            <ScanModalLazy
              isOpen={scanModalOpen}
              onClose={() => {
                setConfigureFromCloudGameId(null);
                setScanModalOpen(false);
                popLayer();
              }}
              onSelectCandidate={handleScanSelect}
              configuredGames={config?.games ?? []}
            />
          </Suspense>
        )}
        {gameToRemove && (
          <Suspense fallback={null}>
            <RemoveGameModalLazy
              isOpen={!!gameToRemove}
              onClose={() => setGameToRemove(null)}
              game={gameToRemove}
              onConfirm={handleConfirmRemove}
              onClearCloudOnly={handleConfirmClearCloudSaves}
              hasCloudIntegration={hasSyncConfig}
            />
          </Suspense>
        )}
        {trashModalOpen && (
          <Suspense fallback={null}>
            <TrashModalLazy
              isOpen={trashModalOpen}
              onClose={() => setTrashModalOpen(false)}
              onRestored={handleRefresh}
            />
          </Suspense>
        )}
        {downloadConflictGame && (
          <Suspense fallback={null}>
            <DownloadConflictModalLazy
              isOpen={!!downloadConflictGame}
              onClose={handleCloseDownloadConflict}
              gameId={downloadConflictGame?.id ?? ""}
              conflicts={downloadConflicts}
              onConfirm={handleConfirmDownloadConflict}
              isLoading={!!downloading && downloading === downloadConflictGame?.id}
            />
          </Suspense>
        )}
        {bulkConfirm && (
          <Suspense fallback={null}>
            <BulkActionConfirmModalLazy
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
          </Suspense>
        )}
        {downloadAllConflictGames.length > 0 && (
          <Suspense fallback={null}>
            <DownloadAllConflictModalLazy
              isOpen={downloadAllConflictGames.length > 0}
              onClose={handleCloseDownloadAllConflict}
              gamesWithConflicts={downloadAllConflictGames}
              onConfirm={handleConfirmDownloadAllConflict}
              isLoading={downloading === "all"}
            />
          </Suspense>
        )}
        {syncPreviewGame && syncPreviewType && (
          <Suspense fallback={null}>
            <SyncPreviewModalLazy
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
          </Suspense>
        )}
        {gameToFullBackupConfirm && (
          <Suspense fallback={null}>
            <FullBackupConfirmModalLazy
              isOpen={!!gameToFullBackupConfirm}
              onClose={() => setGameToFullBackupConfirm(null)}
              game={gameToFullBackupConfirm}
              onConfirm={async () => {
                if (gameToFullBackupConfirm) {
                  await handleFullBackupUpload(gameToFullBackupConfirm);
                }
              }}
            />
          </Suspense>
        )}
        {gameToRestoreBackup && (
          <Suspense fallback={null}>
            <RestoreBackupModalLazy
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
          </Suspense>
        )}
        {gameToEdit && (
          <Suspense fallback={null}>
            <GameDrawerLazy
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
          </Suspense>
        )}
        {gameForTorrent && (
          <Suspense fallback={null}>
            <GameTorrentDrawerLazy
              isOpen={!!gameForTorrent}
              onClose={() => setGameForTorrent(null)}
              game={gameForTorrent}
              cloudEnabled={hasSyncConfig}
            />
          </Suspense>
        )}
        <motion.div
          layout={bigPictureConsole ? "position" : false}
          transition={{ layout: layoutShiftTransition }}
          className={`flex flex-col ${bigPictureConsole ? "gap-5" : "gap-6"} ${!bigPictureConsole ? "mt-6 sm:mt-8" : ""}`}>
          {/* Filtros de la lista */}
          <section className={bigPictureConsole ? "flex flex-wrap items-center gap-x-4 gap-y-2" : "space-y-2"}>
            <h2
              className={`font-medium text-default-500 ${bigPictureConsole ? "shrink-0 text-base md:text-lg" : "text-sm"}`}>
              {bigPictureConsole
                ? t("library.filtersSection.filterByOrigin")
                : t("library.filtersSection.searchAndFilter")}
            </h2>
            <GamesFilters
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              originFilter={originFilter}
              onOriginFilterChange={setOriginFilter}
              omitSearch={bigPictureConsole}
              consoleMode={bigPictureConsole}
            />
          </section>
          {/* Lista de juegos */}
          <section className="space-y-2">
            <h2 className={`font-medium text-default-500 ${bigPictureConsole ? "text-base md:text-lg" : "text-sm"}`}>
              {t("library.menu.gamesTitle")}
            </h2>
            <GamesList
              games={filteredGames}
              consoleMode={bigPictureConsole}
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
