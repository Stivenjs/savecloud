import { useState } from "react";
import { Button, Card, CardBody, Spinner } from "@heroui/react";
import { Copy, RefreshCw, User } from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import { AddGameModal } from "@features/games/AddGameModal";
import { DownloadAllConflictModal } from "@features/games/DownloadAllConflictModal";
import { EditGameModal } from "@features/games/EditGameModal";
import { DownloadConflictModal } from "@features/games/DownloadConflictModal";
import { FullBackupConfirmModal } from "@features/games/FullBackupConfirmModal";
import { RestoreBackupModal } from "@features/games/RestoreBackupModal";
import { SyncPreviewModal } from "@features/games/SyncPreviewModal";
import { GamesFilters } from "@features/games/GamesFilters";
import { GamesList } from "@features/games/GamesList";
import { GamesPageHeader } from "@features/games/GamesPageHeader";
import { GamesStats } from "@features/games/GamesStats";
import { OperationErrorCard } from "@features/games/OperationErrorCard";
import { BulkActionConfirmModal } from "@features/games/BulkActionConfirmModal";
import { RemoveGameModal } from "@features/games/RemoveGameModal";
import { ScanModal } from "@features/games/ScanModal";
import { useGamesPage } from "@features/games/useGamesPage";
import { useGameStats } from "@hooks/useGameStats";
import { scheduleConfigBackupToCloud } from "@services/tauri";
import { countGamesOverSizeThreshold } from "@utils/packageRecommendation";
import { createShareLink } from "@services/share.service";
import { toastError, toastSuccess } from "@utils/toast";

export function GamesPage() {
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
    connectionStatus,
    connectionError,
    searchTerm,
    setSearchTerm,
    originFilter,
    setOriginFilter,
    addModalOpen,
    setAddModalOpen,
    scanModalOpen,
    setScanModalOpen,
    setConfigureFromCloudGameId,
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
    operationResult,
    handleScanSelect,
    handleConfigureFromCloud,
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
    refetchLastSync,
    filteredGames,
    emptyFilterMessage,
    unsyncedGameIds,
    handleDismissOperationError,
    handleRetryOperationError,
  } = useGamesPage();

  const { statsByGameId } = useGameStats(!!config?.games?.length);

  const [gameToEdit, setGameToEdit] = useState<ConfiguredGame | null>(null);
  const [gameToFullBackupConfirm, setGameToFullBackupConfirm] =
    useState<ConfiguredGame | null>(null);

  const handleShare = async (game: ConfiguredGame) => {
    const base = config?.apiBaseUrl?.trim();
    const uid = config?.userId?.trim();
    const key = config?.apiKey?.trim();
    if (!base || !uid || !key) {
      toastError(
        "Falta configuración",
        "Configura API URL, User ID y API Key en Configuración para compartir."
      );
      return;
    }
    try {
      const { shareUrl } = await createShareLink(base, uid, key, game.id);
      await navigator.clipboard.writeText(shareUrl);
      toastSuccess(
        "Link copiado",
        "El link para compartir este juego está en el portapapeles. Válido 7 días."
      );
    } catch (e) {
      toastError(
        "No se pudo crear el link",
        e instanceof Error ? e.message : "Error inesperado"
      );
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
        <Button
          color="primary"
          startContent={<RefreshCw size={18} />}
          onPress={() => refetch?.()}
        >
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Cabecera: título, estado de conexión y acciones */}
      <GamesPageHeader
        hasSyncConfig={hasSyncConfig}
        gamesCount={config?.games?.length ?? 0}
        unsyncedCount={unsyncedGameIds.length}
        syncing={syncing}
        downloading={downloading}
        connectionStatus={connectionStatus}
        connectionError={connectionError}
        onConnectionRetry={() => refetchLastSync?.()}
        onScanPress={() => setScanModalOpen(true)}
        onAddPress={() => {
          setAddModalInitial({ path: "", suggestedId: "" });
          setAddModalOpen(true);
        }}
        onDownloadAllPress={openDownloadAllConfirm}
        onSyncAllPress={openSyncAllConfirm}
        onRefreshPress={handleRefresh}
        isRefreshing={refreshing}
      />

      {/* Tu User ID (para compartir con amigos) */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-default-500">Tu cuenta</h2>
        <Card className="border border-default-200">
          <CardBody className="flex flex-row flex-wrap items-center justify-between gap-3 py-3">
            <div className="flex items-center gap-2">
              <User size={18} className="text-default-500" />
              <span className="text-sm text-default-500">Tu User ID</span>
              {config?.userId?.trim() ? (
                <code className="rounded bg-default-100 px-2 py-0.5 font-mono text-sm text-foreground">
                  {config.userId}
                </code>
              ) : (
                <span className="text-sm text-default-400">
                  Configura tu User ID en Configuración
                </span>
              )}
            </div>
            {config?.userId?.trim() && (
              <Button
                size="sm"
                variant="flat"
                startContent={<Copy size={14} />}
                onPress={async () => {
                  try {
                    await navigator.clipboard.writeText(config.userId ?? "");
                    toastSuccess(
                      "User ID copiado",
                      "Puedes compartirlo con tus amigos."
                    );
                  } catch {
                    // sin clipboard, ignorar
                  }
                }}
              >
                Copiar
              </Button>
            )}
          </CardBody>
        </Card>
      </section>

      <AddGameModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onSuccess={() => {
          scheduleConfigBackupToCloud();
          handleRefresh?.();
        }}
        initialPath={addModalInitial.path}
        suggestedId={addModalInitial.suggestedId}
      />
      <ScanModal
        isOpen={scanModalOpen}
        onClose={() => {
          setConfigureFromCloudGameId(null);
          setScanModalOpen(false);
        }}
        onSelectCandidate={handleScanSelect}
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
                config.games.map((g) => g.id),
                statsByGameId
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
          (!!syncing && syncing === syncPreviewGame?.id) ||
          (!!downloading && downloading === syncPreviewGame?.id)
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
      />
      <EditGameModal
        isOpen={!!gameToEdit}
        game={gameToEdit}
        onClose={() => setGameToEdit(null)}
        onSuccess={() => {
          scheduleConfigBackupToCloud();
          handleRefresh();
          setGameToEdit(null);
        }}
      />

      {/* Resumen: última sync y juegos en la nube */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-default-500">Resumen y nube</h2>
        <GamesStats
          gamesCount={config?.games?.length ?? 0}
          lastSyncAt={lastSyncAt}
          lastSyncGameId={lastSyncGameId}
          lastSyncLoading={hasSyncConfig && lastSyncLoading}
          hasSyncConfig={hasSyncConfig}
          cloudGames={cloudGames}
          totalCloudSize={totalCloudSize}
          onConfigureFromCloud={handleConfigureFromCloud}
        />
      </section>

      {/* Filtros de la lista */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-default-500">
          Buscar y filtrar
        </h2>
        <GamesFilters
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          originFilter={originFilter}
          onOriginFilterChange={setOriginFilter}
        />
      </section>

      {/* Lista de juegos */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-default-500">
          Lista de juegos
        </h2>
        <GamesList
          games={filteredGames}
          emptyFilterMessage={emptyFilterMessage}
          unsyncedGameIds={unsyncedGameIds}
          onEmptyScanPress={() => setScanModalOpen(true)}
          onEmptyAddPress={() => {
            setAddModalInitial({ path: "", suggestedId: "" });
            setAddModalOpen(true);
          }}
          onRemove={handleRemoveGame}
          onSync={hasSyncConfig ? handleSyncOne : undefined}
          syncingId={syncing}
          onDownload={hasSyncConfig ? handleDownloadOne : undefined}
          downloadingId={downloading}
          onOpenFolder={handleOpenFolder}
          onRestoreBackup={handleRestoreBackup}
          onFullBackupUpload={
            hasSyncConfig ? setGameToFullBackupConfirm : undefined
          }
          fullBackupUploadingGameId={fullBackupUploadingGameId}
          onEdit={setGameToEdit}
          onShare={hasSyncConfig ? handleShare : undefined}
          hasSyncConfig={hasSyncConfig}
        />
      </section>

      {operationResult && operationResult.result.errors.length > 0 && (
        <OperationErrorCard
          operationResult={operationResult}
          onDismiss={handleDismissOperationError}
          onRetry={handleRetryOperationError}
        />
      )}
    </div>
  );
}
