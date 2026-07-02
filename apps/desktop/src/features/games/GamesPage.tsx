import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Spinner } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { RefreshCw } from "lucide-react";
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
import { useShellUiStore } from "@store/ShellUiStore";

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
      toastSuccess("Link copiado", "El link para compartir este juego está en el portapapeles. Válido 7 días.");
    } catch (e) {
      toastError("No se pudo crear el link", e instanceof Error ? e.message : "Error inesperado");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
        <Spinner size="lg" color="primary" />
        <p className="text-default-500">{t("common.loading")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
        <p className="text-danger">{error}</p>
        <Button color="primary" startContent={<RefreshCw size={18} />} onPress={() => refetch?.()}>
          {t("common.retry", "Reintentar")}
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
                    isRefreshing={refreshing}
                  />
                </div>
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
          className={`flex flex-col ${bigPictureConsole ? "gap-5" : "gap-6"} ${!bigPictureConsole ? "mt-6 sm:mt-8" : ""}`}>
          {/* Filtros de la lista */}
          <section className={bigPictureConsole ? "flex flex-wrap items-center gap-x-4 gap-y-2" : "space-y-2"}>
            <h2
              className={`font-medium text-default-500 ${bigPictureConsole ? "shrink-0 text-base md:text-lg" : "text-sm"}`}>
              {bigPictureConsole ? "Filtrar por origen" : "Buscar y filtrar"}
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
              Lista de juegos
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
