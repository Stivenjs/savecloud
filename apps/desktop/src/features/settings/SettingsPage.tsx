import { useState, lazy, Suspense, type ReactNode } from "react";
import { Tab, Tabs } from "@heroui/react";
import { AppWindow, Bell, Cloud, FlaskConical, RefreshCw } from "lucide-react";
import { AutostartCard } from "@features/settings/AutostartCard";
import { ConfigSection } from "@features/settings/ConfigSection";
import { CreateConfigModal } from "@features/settings/CreateConfigModal";
import { ExperimentalFeaturesCard } from "@features/settings/ExperimentalFeaturesCard";
import { LocalBackupInfoCard } from "@features/settings/LocalBackupInfoCard";
import { NotificationsCard } from "@features/settings/NotificationsCard";
import { ProfileStartupBehaviorCard } from "@features/settings/ProfileStartupBehaviorCard";
import { ReleaseNotesCard } from "@features/settings/ReleaseNotesCard";
import { RestoreConfigModal } from "@features/settings/RestoreConfigModal";
import { ResetSteamCatalogModal } from "@features/settings/ResetSteamCatalogModal";
import { ResetCloudSeedModal } from "@features/settings/ResetCloudSeedModal";
import { PullFriendConfigModal } from "@/features/settings/PullFriendConfigModal";
import { UpdatesCard } from "@features/settings/UpdatesCard";
import { useSettingsPage } from "@/hooks/useSettingsPage";
import { useProfileSession } from "@hooks/useProfileSession";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";
import { useNavigationStore } from "@features/input/store";
import { DevSdk } from "@features/settings/DevSdk";
import { SourceInstallSettingsCard } from "@features/settings/SourceInstallSettingsCard";
import { VoiceCommandsCard } from "@features/voice-commands";
import { HealthObservabilityCard } from "@features/settings/HealthObservabilityCard";
import { SettingsSidebar, type SettingsTabKey } from "@features/settings/SettingsSidebar";

const ReleaseNotesDialogLazy = lazy(() =>
  import("@features/settings/ReleaseNotesDialog").then((module) => ({ default: module.ReleaseNotesDialog }))
);

const SETTINGS_TABS: Array<{
  key: SettingsTabKey;
  label: string;
  icon: ReactNode;
}> = [
  { key: "account", label: "Cuenta", icon: <Cloud size={17} className="opacity-90" /> },
  { key: "app", label: "Inicio y app", icon: <AppWindow size={17} className="opacity-90" /> },
  { key: "integrations", label: "Integraciones", icon: <Bell size={17} className="opacity-90" /> },
  { key: "updates", label: "Versiones", icon: <RefreshCw size={17} className="opacity-90" /> },
  { key: "advanced", label: "Avanzado", icon: <FlaskConical size={17} className="opacity-90" /> },
];

interface SettingsPageProps {
  compactWindowMode?: boolean;
}

export function SettingsPage({ compactWindowMode = false }: SettingsPageProps) {
  const { activeProfile } = useProfileSession();
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [resetCloudSeedModalOpen, setResetCloudSeedModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabKey>("account");
  const {
    autostart,
    alwaysShowProfileSelector,
    loading,
    loadingAlwaysShowProfileSelector,
    loadingConfigData,
    testingNotification,
    exporting,
    importing,
    checkingUpdate,
    configPath,
    config,
    s3TransferEndpointType,
    createConfigModalOpen,
    createApiBaseUrl,
    createWsBaseUrl,
    createApiKey,
    createUserId,
    createSteamWebApiKey,
    creatingConfig,
    createConfigError,
    pullFriendConfigModalOpen,
    pullFriendUserId,
    pullingFriendConfig,
    backingUpConfig,
    restoringConfig,
    restoreConfirmOpen,
    resetSteamCatalogConfirmOpen,
    handleExportConfig,
    handleImportConfig,
    handleCheckUpdates,
    handleBackupConfigToCloud,
    performRestoreConfigFromCloud,
    handleTestNotification,
    handleCreateConfigFile,
    handlePullFriendConfig,
    handleAutostartChange,
    handleAlwaysShowProfileSelectorChange,
    handleFullBackupStreamingChange,
    handleFullBackupStreamingDryRunChange,
    handleSyncSteamCatalog,
    handleResetSteamCatalogSync,
    confirmResetSteamCatalogSync,
    steamCatalogBusy,
    steamSeedBusy,
    steamCatalogSyncProgress,
    steamSeedImportProgress,
    handleExportSteamSeedManifest,
    handleResetCloudSeed,
    handleImportCloudSeedFromCloud,
    openCreateConfigModal,
    setCreateApiBaseUrl,
    setCreateWsBaseUrl,
    setCreateApiKey,
    setCreateUserId,
    setCreateSteamWebApiKey,
    setCreateConfigModalOpen,
    setRestoreConfirmOpen,
    setResetSteamCatalogConfirmOpen,
    setPullFriendConfigModalOpen,
    setPullFriendUserId,
    sourcesBusy,
    sourceUrl,
    defaultSourceDownloadDir,
    sourcesSummary,
    setSourceUrl,
    setDefaultSourceDownloadDir,
    handleImportSourceByUrl,
    handleImportSourceByFile,
    handleImportSourcesBatch,
    handleSelectDefaultSourceDownloadDir,
    handleSaveDefaultSourceDownloadDir,
    deletingSourceIds,
    handleDeleteSource,
  } = useSettingsPage();

  const popLayer = useNavigationStore((s) => s.popLayer);

  useRegisterGlobalBack(() => {
    switch (true) {
      case releaseNotesOpen:
        setReleaseNotesOpen(false);
        return true;
      case resetCloudSeedModalOpen:
        setResetCloudSeedModalOpen(false);
        return true;
      case restoreConfirmOpen:
        setRestoreConfirmOpen(false);
        return true;
      case resetSteamCatalogConfirmOpen:
        setResetSteamCatalogConfirmOpen(false);
        return true;
      case pullFriendConfigModalOpen:
        setPullFriendConfigModalOpen(false);
        return true;
      case createConfigModalOpen:
        setCreateConfigModalOpen(false);
        return true;
      default:
        popLayer();
        return true;
    }
  });

  const renderTabContent = (tab: SettingsTabKey) => {
    switch (tab) {
      case "account":
        return (
          <ConfigSection
            exporting={exporting}
            importing={importing}
            backingUpConfig={backingUpConfig}
            restoringConfig={restoringConfig}
            configPath={configPath}
            userId={activeProfile?.localUserId || config?.userId}
            hasSteamWebApiKey={!!config?.steamWebApiKey?.trim()}
            s3TransferEndpointType={s3TransferEndpointType}
            isLoadingData={loadingConfigData}
            steamCatalogBusy={steamCatalogBusy}
            steamSeedBusy={steamSeedBusy}
            steamCatalogSyncProgress={steamCatalogSyncProgress}
            steamSeedImportProgress={steamSeedImportProgress}
            onCreateConfig={openCreateConfigModal}
            onPullFriendConfig={() => setPullFriendConfigModalOpen(true)}
            onExport={handleExportConfig}
            onImportMerge={() => handleImportConfig("merge")}
            onImportReplace={() => handleImportConfig("replace")}
            onBackupToCloud={handleBackupConfigToCloud}
            onRestoreFromCloud={() => setRestoreConfirmOpen(true)}
            onSyncSteamCatalog={handleSyncSteamCatalog}
            onResetSteamCatalogSync={handleResetSteamCatalogSync}
            onExportSteamSeedManifest={handleExportSteamSeedManifest}
            onResetCloudSeedState={handleResetCloudSeed}
            onImportCloudSeedFromCloud={handleImportCloudSeedFromCloud}
            onOpenResetCloudSeedModal={() => setResetCloudSeedModalOpen(true)}
          />
        );
      case "app":
        return (
          <div className="space-y-3">
            <AutostartCard autostart={autostart} loading={loading} onChange={handleAutostartChange} />
            <ProfileStartupBehaviorCard
              alwaysShowProfileSelector={alwaysShowProfileSelector}
              loading={loadingAlwaysShowProfileSelector}
              onChange={handleAlwaysShowProfileSelectorChange}
            />
          </div>
        );
      case "integrations":
        return (
          <div className="space-y-3">
            <NotificationsCard testingNotification={testingNotification} onTestNotification={handleTestNotification} />
            <VoiceCommandsCard />
            <SourceInstallSettingsCard
              sourceUrl={sourceUrl}
              defaultDownloadDir={defaultSourceDownloadDir}
              sourcesBusy={sourcesBusy}
              sources={sourcesSummary}
              deletingSourceIds={deletingSourceIds}
              onSourceUrlChange={setSourceUrl}
              onDefaultDownloadDirChange={setDefaultSourceDownloadDir}
              onImportUrl={() => handleImportSourceByUrl("merge")}
              onImportFile={() => handleImportSourceByFile("merge")}
              onImportBatch={() => handleImportSourcesBatch("updateorcreate")}
              onPickFolder={handleSelectDefaultSourceDownloadDir}
              onSaveDefaultDir={handleSaveDefaultSourceDownloadDir}
              onDeleteSource={handleDeleteSource}
            />
          </div>
        );
      case "updates":
        return (
          <div className="grid gap-3 xl:grid-cols-2">
            <UpdatesCard checkingUpdate={checkingUpdate} onCheckUpdates={handleCheckUpdates} />
            <ReleaseNotesCard onOpenNotes={() => setReleaseNotesOpen(true)} />
          </div>
        );
      case "advanced":
        return (
          <div className="space-y-3">
            <HealthObservabilityCard />
            <LocalBackupInfoCard />
            <ExperimentalFeaturesCard
              fullBackupStreaming={!!config?.fullBackupStreaming}
              onFullBackupStreamingChange={handleFullBackupStreamingChange}
              fullBackupStreamingDryRun={!!config?.fullBackupStreamingDryRun}
              onFullBackupStreamingDryRunChange={handleFullBackupStreamingDryRunChange}
            />
            <DevSdk />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className={compactWindowMode ? "h-full min-h-0" : "space-y-6"}>
      {compactWindowMode ? (
        <div className="grid h-full min-h-0 grid-cols-[240px_minmax(0,1fr)] gap-4">
          <SettingsSidebar tabs={SETTINGS_TABS} selectedTab={settingsTab} onSelectTab={setSettingsTab} />
          <section className="min-w-0 h-full min-h-0 overflow-y-auto pr-1">{renderTabContent(settingsTab)}</section>
        </div>
      ) : (
        <>
          <div>
            <h1 className="text-2xl font-semibold">Configuración</h1>
            <p className="mt-1 text-sm text-default-500">
              Ajusta tu cuenta, comportamiento de la app e integraciones desde un solo lugar.
            </p>
          </div>

          <Tabs
            aria-label="Secciones de configuración"
            selectedKey={settingsTab}
            onSelectionChange={(key) => setSettingsTab(String(key) as SettingsTabKey)}
            variant="underlined"
            color="primary"
            classNames={{
              tabList: "gap-4 w-full border-b border-default-200",
              tab: "h-11 px-0 data-[selected=true]:font-semibold",
              panel: "pt-5",
            }}>
            {SETTINGS_TABS.map((tab) => (
              <Tab
                key={tab.key}
                title={
                  <span className="flex items-center gap-2">
                    {tab.icon}
                    {tab.label}
                  </span>
                }>
                {renderTabContent(tab.key)}
              </Tab>
            ))}
          </Tabs>
        </>
      )}
      <CreateConfigModal
        isOpen={createConfigModalOpen}
        apiBaseUrl={createApiBaseUrl}
        wsBaseUrl={createWsBaseUrl}
        apiKey={createApiKey}
        userId={createUserId}
        steamWebApiKey={createSteamWebApiKey}
        error={createConfigError}
        creating={creatingConfig}
        onApiBaseUrlChange={setCreateApiBaseUrl}
        onWsBaseUrlChange={setCreateWsBaseUrl}
        onApiKeyChange={setCreateApiKey}
        onUserIdChange={setCreateUserId}
        onSteamWebApiKeyChange={setCreateSteamWebApiKey}
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
      <ResetSteamCatalogModal
        isOpen={resetSteamCatalogConfirmOpen}
        busy={steamCatalogBusy}
        onCancel={() => setResetSteamCatalogConfirmOpen(false)}
        onConfirm={confirmResetSteamCatalogSync}
      />
      <ResetCloudSeedModal
        isOpen={resetCloudSeedModalOpen}
        busy={steamSeedBusy}
        onCancel={() => setResetCloudSeedModalOpen(false)}
        onConfirm={async () => {
          await handleResetCloudSeed();
          setResetCloudSeedModalOpen(false);
        }}
      />
      <PullFriendConfigModal
        isOpen={pullFriendConfigModalOpen}
        userId={pullFriendUserId}
        pulling={pullingFriendConfig}
        onChangeUserId={setPullFriendUserId}
        onClose={() => setPullFriendConfigModalOpen(false)}
        onSubmit={handlePullFriendConfig}
      />
      {releaseNotesOpen && (
        <Suspense fallback={null}>
          <ReleaseNotesDialogLazy isOpen={releaseNotesOpen} onClose={() => setReleaseNotesOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
