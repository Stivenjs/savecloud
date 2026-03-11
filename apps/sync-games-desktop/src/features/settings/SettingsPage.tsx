import { useState } from "react";
import { AutostartCard } from "@features/settings/AutostartCard";
import { ConfigSection } from "@features/settings/ConfigSection";
import { CreateConfigModal } from "@features/settings/CreateConfigModal";
import { ExperimentalFeaturesCard } from "@features/settings/ExperimentalFeaturesCard";
import { LocalBackupInfoCard } from "@features/settings/LocalBackupInfoCard";
import { NotificationsCard } from "@features/settings/NotificationsCard";
import { ReleaseNotesCard } from "@features/settings/ReleaseNotesCard";
import { ReleaseNotesDialog } from "@features/settings/ReleaseNotesDialog";
import { RestoreConfigModal } from "@features/settings/RestoreConfigModal";
import { UpdatesCard } from "@features/settings/UpdatesCard";
import { useSettingsPage } from "@features/settings/useSettingsPage";

export function SettingsPage() {
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const {
    autostart,
    loading,
    testingNotification,
    exporting,
    importing,
    checkingUpdate,
    configPath,
    config,
    s3TransferEndpointType,
    createConfigModalOpen,
    createApiBaseUrl,
    createApiKey,
    createUserId,
    creatingConfig,
    createConfigError,
    backingUpConfig,
    restoringConfig,
    restoreConfirmOpen,
    handleExportConfig,
    handleImportConfig,
    handleCheckUpdates,
    handleBackupConfigToCloud,
    performRestoreConfigFromCloud,
    handleTestNotification,
    handleCreateConfigFile,
    handleAutostartChange,
    handleFullBackupStreamingChange,
    handleFullBackupStreamingDryRunChange,
    openCreateConfigModal,
    setCreateApiBaseUrl,
    setCreateApiKey,
    setCreateUserId,
    setCreateConfigModalOpen,
    setRestoreConfirmOpen,
  } = useSettingsPage();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configuración</h1>
        <p className="mt-1 text-sm text-default-500">
          Archivo de config, respaldos, inicio con Windows, actualizaciones y
          notificaciones.
        </p>
      </div>

      <ConfigSection
        exporting={exporting}
        importing={importing}
        backingUpConfig={backingUpConfig}
        restoringConfig={restoringConfig}
        configPath={configPath}
        userId={config?.userId}
        s3TransferEndpointType={s3TransferEndpointType}
        onCreateConfig={openCreateConfigModal}
        onExport={handleExportConfig}
        onImportMerge={() => handleImportConfig("merge")}
        onImportReplace={() => handleImportConfig("replace")}
        onBackupToCloud={handleBackupConfigToCloud}
        onRestoreFromCloud={() => setRestoreConfirmOpen(true)}
      />

      <AutostartCard
        autostart={autostart}
        loading={loading}
        onChange={handleAutostartChange}
      />
      <UpdatesCard
        checkingUpdate={checkingUpdate}
        onCheckUpdates={handleCheckUpdates}
      />
      <ReleaseNotesCard onOpenNotes={() => setReleaseNotesOpen(true)} />
      <NotificationsCard
        testingNotification={testingNotification}
        onTestNotification={handleTestNotification}
      />

      <LocalBackupInfoCard />
      <ExperimentalFeaturesCard
        fullBackupStreaming={!!config?.fullBackupStreaming}
        onFullBackupStreamingChange={handleFullBackupStreamingChange}
        fullBackupStreamingDryRun={!!config?.fullBackupStreamingDryRun}
        onFullBackupStreamingDryRunChange={handleFullBackupStreamingDryRunChange}
      />

      <CreateConfigModal
        isOpen={createConfigModalOpen}
        apiBaseUrl={createApiBaseUrl}
        apiKey={createApiKey}
        userId={createUserId}
        error={createConfigError}
        creating={creatingConfig}
        onApiBaseUrlChange={setCreateApiBaseUrl}
        onApiKeyChange={setCreateApiKey}
        onUserIdChange={setCreateUserId}
        onClose={() => setCreateConfigModalOpen(false)}
        onSubmit={handleCreateConfigFile}
      />
      <RestoreConfigModal
        isOpen={restoreConfirmOpen}
        restoring={restoringConfig}
        onCancel={() => setRestoreConfirmOpen(false)}
        onConfirm={async () => {
          await performRestoreConfigFromCloud();
          setRestoreConfirmOpen(false);
        }}
      />
      <ReleaseNotesDialog
        isOpen={releaseNotesOpen}
        onClose={() => setReleaseNotesOpen(false)}
      />
    </div>
  );
}
