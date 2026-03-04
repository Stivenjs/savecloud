import { Button, Card, CardBody, Spinner } from "@heroui/react";
import { Copy, RefreshCw, User } from "lucide-react";
import { AddGameModal } from "@features/games/AddGameModal";
import { DownloadAllConflictModal } from "@features/games/DownloadAllConflictModal";
import { DownloadConflictModal } from "@features/games/DownloadConflictModal";
import { RestoreBackupModal } from "@features/games/RestoreBackupModal";
import { SyncPreviewModal } from "@features/games/SyncPreviewModal";
import { GamesFilters } from "@features/games/GamesFilters";
import { GamesList } from "@features/games/GamesList";
import { GamesPageHeader } from "@features/games/GamesPageHeader";
import { GamesStats } from "@features/games/GamesStats";
import { OperationErrorCard } from "@features/games/OperationErrorCard";
import { RemoveGameModal } from "@features/games/RemoveGameModal";
import { ScanModal } from "@features/games/ScanModal";
import { useGamesPage } from "@features/games/useGamesPage";
import { toastSuccess } from "@utils/toast";

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
    operationResult,
    handleScanSelect,
    handleConfigureFromCloud,
    handleRemoveGame,
    handleConfirmRemove,
    handleSyncOne,
    handleDownloadOne,
    syncPreviewGame,
    syncPreviewType,
    handleConfirmSyncPreview,
    handleCloseSyncPreview,
    gameToRestoreBackup,
    handleRestoreBackup,
    handleCloseRestoreBackup,
    handleSyncAll,
    handleDownloadAll,
    handleOpenFolder,
    handleRefresh,
    refetchLastSync,
    filteredGames,
    emptyFilterMessage,
  } = useGamesPage();

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
      <GamesPageHeader
        hasSyncConfig={hasSyncConfig}
        gamesCount={config?.games?.length ?? 0}
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
        onDownloadAllPress={handleDownloadAll}
        onSyncAllPress={handleSyncAll}
        onRefreshPress={handleRefresh}
      />

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
                  toastSuccess("User ID copiado", "Puedes compartirlo con tus amigos.");
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

      <AddGameModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onSuccess={() => refetch?.()}
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
        isLoading={
          (!!syncing && syncing === syncPreviewGame?.id) ||
          (!!downloading && downloading === syncPreviewGame?.id)
        }
      />
      <RestoreBackupModal
        isOpen={!!gameToRestoreBackup}
        onClose={handleCloseRestoreBackup}
        game={gameToRestoreBackup}
        onSuccess={handleRefresh}
      />

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

      <GamesFilters
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        originFilter={originFilter}
        onOriginFilterChange={setOriginFilter}
      />

      <GamesList
        games={filteredGames}
        onRemove={handleRemoveGame}
        onSync={hasSyncConfig ? handleSyncOne : undefined}
        syncingId={syncing}
        onDownload={hasSyncConfig ? handleDownloadOne : undefined}
        downloadingId={downloading}
        onOpenFolder={handleOpenFolder}
        onRestoreBackup={handleRestoreBackup}
        emptyFilterMessage={emptyFilterMessage}
      />

      {operationResult && operationResult.result.errors.length > 0 && (
        <OperationErrorCard operationResult={operationResult} />
      )}
    </div>
  );
}
