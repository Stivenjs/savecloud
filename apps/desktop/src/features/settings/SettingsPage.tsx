import { useState, lazy, Suspense, useEffect, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { Tab, Tabs } from "@heroui/react";
import { useTranslation } from "react-i18next";
import {
  AppWindow,
  Bell,
  Blocks,
  Cloud,
  Download,
  FlaskConical,
  Gamepad2,
  Monitor,
  RefreshCw,
  User,
} from "lucide-react";
import { AutostartCard } from "@features/settings/AutostartCard";
import { BigPictureModeCard } from "@features/settings/BigPictureModeCard";
import { ConfigSection } from "@features/settings/ConfigSection";
import { ExperimentalFeaturesCard } from "@features/settings/ExperimentalFeaturesCard";
import { LocalBackupInfoCard } from "@features/settings/LocalBackupInfoCard";
import { NotificationsCard } from "@features/settings/NotificationsCard";
import { ProfileStartupBehaviorCard } from "@features/settings/ProfileStartupBehaviorCard";
import { ReleaseNotesCard } from "@features/settings/ReleaseNotesCard";
import { UpdatesCard } from "@features/settings/UpdatesCard";
import { useSettingsPage } from "@/hooks/useSettingsPage";
import { useProfileSession } from "@hooks/useProfileSession";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";
import { useNavigationStore } from "@features/input/store";
import { DeveloperModeCard } from "@features/settings/DeveloperModeCard";
import { GamepadTesterCard } from "@features/settings/GamepadTesterCard";
import { GameModeCard } from "@features/settings/GameModeCard";
import { LowPerformanceModeCard } from "@features/settings/LowPerformanceModeCard";
import { DisableHardwareAccelerationCard } from "@features/settings/DisableHardwareAccelerationCard";
import { LanguageSettingsCard } from "@features/settings/LanguageSettingsCard";
import { SettingsSidebarAnimatedPanel } from "@features/settings/SettingsSidebarAnimatedPanel";
import { SettingsSidebar, type SettingsTabKey } from "@features/settings/SettingsSidebar";
import { useSettingsSidebarPanelDirection } from "@features/settings/useSettingsSidebarPanelDirection";
import {
  parseSettingsTabQueryValue,
  SAVECLOUD_SETTINGS_SELECT_TAB_EVENT,
  type SavecloudSettingsSelectTabPayload,
} from "@/constants/savecloudCrossWindow";
import {
  SourcesTabSkeleton,
  IntegrationsTabSkeleton,
  CloudTabSkeleton,
  PluginsTabSkeleton,
  ObservabilityCardSkeleton,
} from "@/features/settings/SettingsTabSkeletons";

const CloudDashboardPanelLazy = lazy(() =>
  import("@features/settings/CloudDashboardPanel").then((m) => ({ default: m.CloudDashboardPanel }))
);
const HealthObservabilityCardLazy = lazy(() =>
  import("@features/settings/HealthObservabilityCard").then((m) => ({ default: m.HealthObservabilityCard }))
);
const PluginsSettingsSectionLazy = lazy(() =>
  import("@features/settings/plugins/PluginsSettingsSection").then((m) => ({ default: m.PluginsSettingsSection }))
);
const CreateConfigModalLazy = lazy(() =>
  import("@features/settings/CreateConfigModal").then((m) => ({ default: m.CreateConfigModal }))
);
const RestoreConfigModalLazy = lazy(() =>
  import("@features/settings/RestoreConfigModal").then((m) => ({ default: m.RestoreConfigModal }))
);
const ResetSteamCatalogModalLazy = lazy(() =>
  import("@features/settings/ResetSteamCatalogModal").then((m) => ({ default: m.ResetSteamCatalogModal }))
);
const ResetCloudSeedModalLazy = lazy(() =>
  import("@features/settings/ResetCloudSeedModal").then((m) => ({ default: m.ResetCloudSeedModal }))
);
const PullFriendConfigModalLazy = lazy(() =>
  import("@/features/settings/PullFriendConfigModal").then((m) => ({ default: m.PullFriendConfigModal }))
);

const SourceInstallSettingsCardLazy = lazy(() =>
  import("@features/settings/SourceInstallSettingsCard").then((m) => ({ default: m.SourceInstallSettingsCard }))
);
const ProxySettingsCardLazy = lazy(() =>
  import("@features/settings/ProxySettingsCard").then((m) => ({ default: m.ProxySettingsCard }))
);
const EmulatorIntegrationsCardLazy = lazy(() =>
  import("@features/settings/EmulatorIntegrationsCard").then((m) => ({ default: m.EmulatorIntegrationsCard }))
);
const VoiceCommandsCardLazy = lazy(() =>
  import("@features/voice-commands").then((m) => ({ default: m.VoiceCommandsCard }))
);
const AudioOutputSettingsCardLazy = lazy(() =>
  import("@features/settings/AudioOutputSettingsCard").then((m) => ({ default: m.AudioOutputSettingsCard }))
);

const ReleaseNotesDialogLazy = lazy(() =>
  import("@features/settings/ReleaseNotesDialog").then((module) => ({ default: module.ReleaseNotesDialog }))
);

const SETTINGS_TABS: Array<{
  key: SettingsTabKey;
  label: string;
  icon: ReactNode;
}> = [
  { key: "account", label: "Cuenta", icon: <User size={17} className="opacity-90" /> },
  { key: "cloud", label: "Nube", icon: <Cloud size={17} className="opacity-90" /> },
  { key: "app", label: "Inicio y app", icon: <AppWindow size={17} className="opacity-90" /> },
  { key: "big-picture", label: "Big Picture", icon: <Monitor size={17} className="opacity-90" /> },
  { key: "sources", label: "Fuentes", icon: <Download size={17} className="opacity-90" /> },
  { key: "integrations", label: "Integraciones", icon: <Bell size={17} className="opacity-90" /> },
  { key: "gamepad", label: "Mando", icon: <Gamepad2 size={17} className="opacity-90" /> },
  { key: "plugins", label: "Plugins", icon: <Blocks size={17} className="opacity-90" /> },
  { key: "updates", label: "Versiones", icon: <RefreshCw size={17} className="opacity-90" /> },
  { key: "advanced", label: "Avanzado", icon: <FlaskConical size={17} className="opacity-90" /> },
];

interface SettingsPageProps {
  compactWindowMode?: boolean;
  /** Solo ventana de ajustes: pestaña inicial desde query `tab`. */
  initialSelectedTab?: SettingsTabKey | null;
}

export function SettingsPage({ compactWindowMode = false, initialSelectedTab = null }: SettingsPageProps) {
  const { t } = useTranslation();
  const getTabTranslationKey = (key: SettingsTabKey): string => {
    switch (key) {
      case "big-picture":
        return "settings.tabs.bigPicture";
      default:
        return `settings.tabs.${key}`;
    }
  };
  const { activeProfile } = useProfileSession();
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [resetCloudSeedModalOpen, setResetCloudSeedModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabKey>(
    () => parseSettingsTabQueryValue(initialSelectedTab ?? null) ?? "account"
  );
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
    handleFullBackupPackagedCompressionLevelChange,
    handleDeveloperModeChange,
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
    proxyUrl,
    setProxyUrl,
    handleSaveProxyUrl,
    sourceUrl,
    remoteSourceUrl,
    defaultSourceDownloadDir,
    sourcesSummary,
    remoteSources,
    verifiedSourcesStatus,
    setSourceUrl,
    setRemoteSourceUrl,
    setDefaultSourceDownloadDir,
    handleImportSourceByUrl,
    handleImportSourceByFile,
    handleImportSourcesBatch,
    handleRegisterRemoteSource,
    handleToggleRemoteSourceEnabled,
    handleDeleteRemoteSource,
    handleInstallVerifiedSources,
    handleSyncRemoteSources,
    handleSelectDefaultSourceDownloadDir,
    handleSaveDefaultSourceDownloadDir,
    deletingSourceIds,
    deletingRemoteSourceIds,
    exportingSourceIds,
    exportingAllSources,
    handleExportAllSources,
    handleExportSource,
    handleDeleteSource,
    handleAutoExtractDownloadsChange,
  } = useSettingsPage();

  const settingsSidebarPanelDirection = useSettingsSidebarPanelDirection(settingsTab);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<SavecloudSettingsSelectTabPayload>(SAVECLOUD_SETTINGS_SELECT_TAB_EVENT, (e) => {
      const raw = e.payload?.tab;
      const next = raw ? parseSettingsTabQueryValue(String(raw)) : null;
      if (next) setSettingsTab(next);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

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
      case "cloud":
        return (
          <Suspense fallback={<CloudTabSkeleton />}>
            <CloudDashboardPanelLazy onSelectAccountTab={() => setSettingsTab("account")} />
          </Suspense>
        );
      case "app":
        return (
          <div className="space-y-3">
            <LanguageSettingsCard />
            <GameModeCard />
            <LowPerformanceModeCard />
            <DisableHardwareAccelerationCard />
            <AutostartCard autostart={autostart} loading={loading} onChange={handleAutostartChange} />
            <ProfileStartupBehaviorCard
              alwaysShowProfileSelector={alwaysShowProfileSelector}
              loading={loadingAlwaysShowProfileSelector}
              onChange={handleAlwaysShowProfileSelectorChange}
            />
          </div>
        );
      case "big-picture":
        return (
          <div className="space-y-3">
            <BigPictureModeCard />
          </div>
        );
      case "sources":
        return (
          <Suspense fallback={<SourcesTabSkeleton />}>
            <div className="space-y-4">
              <ProxySettingsCardLazy proxyUrl={proxyUrl} onProxyUrlChange={setProxyUrl} onSave={handleSaveProxyUrl} />
              <SourceInstallSettingsCardLazy
                sourceUrl={sourceUrl}
                remoteSourceUrl={remoteSourceUrl}
                defaultDownloadDir={defaultSourceDownloadDir}
                sourcesBusy={sourcesBusy}
                sources={sourcesSummary}
                remoteSources={remoteSources}
                verifiedSourcesStatus={verifiedSourcesStatus}
                deletingSourceIds={deletingSourceIds}
                deletingRemoteSourceIds={deletingRemoteSourceIds}
                exportingSourceIds={exportingSourceIds}
                exportingAllSources={exportingAllSources}
                onSourceUrlChange={setSourceUrl}
                onRemoteSourceUrlChange={setRemoteSourceUrl}
                onDefaultDownloadDirChange={setDefaultSourceDownloadDir}
                onImportUrl={() => handleImportSourceByUrl("merge")}
                onImportFile={() => handleImportSourceByFile("merge")}
                onImportBatch={() => handleImportSourcesBatch("updateorcreate")}
                onExportAllSources={handleExportAllSources}
                onExportSource={handleExportSource}
                onRegisterRemoteSource={handleRegisterRemoteSource}
                onToggleRemoteSourceEnabled={handleToggleRemoteSourceEnabled}
                onDeleteRemoteSource={handleDeleteRemoteSource}
                onInstallVerifiedSources={handleInstallVerifiedSources}
                onSyncRemoteSources={handleSyncRemoteSources}
                onPickFolder={handleSelectDefaultSourceDownloadDir}
                onSaveDefaultDir={handleSaveDefaultSourceDownloadDir}
                onDeleteSource={handleDeleteSource}
                autoExtractDownloads={config?.autoExtractDownloads ?? true}
                onAutoExtractDownloadsChange={handleAutoExtractDownloadsChange}
              />
            </div>
          </Suspense>
        );
      case "integrations":
        return (
          <Suspense fallback={<IntegrationsTabSkeleton />}>
            <div className="space-y-4">
              <AudioOutputSettingsCardLazy />
              <NotificationsCard
                testingNotification={testingNotification}
                onTestNotification={handleTestNotification}
              />
              <VoiceCommandsCardLazy />
              <EmulatorIntegrationsCardLazy />
            </div>
          </Suspense>
        );
      case "gamepad":
        return (
          <div className="space-y-3">
            <GamepadTesterCard />
          </div>
        );
      case "plugins":
        return (
          <Suspense fallback={<PluginsTabSkeleton />}>
            <PluginsSettingsSectionLazy />
          </Suspense>
        );
      case "updates":
        return (
          <div className="grid gap-3 xl:grid-cols-2">
            <UpdatesCard checkingUpdate={checkingUpdate} onCheckUpdates={handleCheckUpdates} />
            <ReleaseNotesCard onOpenNotes={() => setReleaseNotesOpen(true)} />
          </div>
        );
      case "advanced": {
        return (
          <div className="space-y-3">
            <Suspense fallback={<ObservabilityCardSkeleton />}>
              <HealthObservabilityCardLazy />
            </Suspense>
            <LocalBackupInfoCard />
            <DeveloperModeCard enabled={!!activeProfile?.developerMode} onEnabledChange={handleDeveloperModeChange} />
            <ExperimentalFeaturesCard
              key={`experimental-${activeProfile?.id ?? "no-profile"}`}
              fullBackupStreaming={!!config?.fullBackupStreaming}
              onFullBackupStreamingChange={handleFullBackupStreamingChange}
              fullBackupStreamingDryRun={!!config?.fullBackupStreamingDryRun}
              onFullBackupStreamingDryRunChange={handleFullBackupStreamingDryRunChange}
              fullBackupPackagedCompressionLevel={config?.fullBackupPackagedCompressionLevel}
              onFullBackupPackagedCompressionLevelChange={handleFullBackupPackagedCompressionLevelChange}
            />
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className={compactWindowMode ? "h-full min-h-0" : "space-y-6"}>
      {compactWindowMode ? (
        <div className="grid h-full min-h-0 grid-cols-[minmax(248px,280px)_minmax(0,1fr)] gap-4">
          <SettingsSidebar tabs={SETTINGS_TABS} selectedTab={settingsTab} onSelectTab={setSettingsTab} />
          <section className="min-w-0 h-full min-h-0 overflow-y-auto pr-1">
            <SettingsSidebarAnimatedPanel
              panelKey={settingsTab}
              direction={settingsSidebarPanelDirection}
              className="min-h-0">
              {renderTabContent(settingsTab)}
            </SettingsSidebarAnimatedPanel>
          </section>
        </div>
      ) : (
        <>
          <div>
            <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
            <p className="mt-1 text-sm text-default-500">{t("settings.subtitle")}</p>
          </div>

          <Tabs
            aria-label={t("settings.title")}
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
                    {t(getTabTranslationKey(tab.key))}
                  </span>
                }>
                {renderTabContent(tab.key)}
              </Tab>
            ))}
          </Tabs>
        </>
      )}
      {createConfigModalOpen && (
        <Suspense fallback={null}>
          <CreateConfigModalLazy
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
        </Suspense>
      )}
      {restoreConfirmOpen && (
        <Suspense fallback={null}>
          <RestoreConfigModalLazy
            isOpen={restoreConfirmOpen}
            restoring={restoringConfig}
            onCancel={() => setRestoreConfirmOpen(false)}
            onConfirm={async () => {
              await performRestoreConfigFromCloud();
              setRestoreConfirmOpen(false);
            }}
          />
        </Suspense>
      )}
      {resetSteamCatalogConfirmOpen && (
        <Suspense fallback={null}>
          <ResetSteamCatalogModalLazy
            isOpen={resetSteamCatalogConfirmOpen}
            busy={steamCatalogBusy}
            onCancel={() => setResetSteamCatalogConfirmOpen(false)}
            onConfirm={confirmResetSteamCatalogSync}
          />
        </Suspense>
      )}
      {resetCloudSeedModalOpen && (
        <Suspense fallback={null}>
          <ResetCloudSeedModalLazy
            isOpen={resetCloudSeedModalOpen}
            busy={steamSeedBusy}
            onCancel={() => setResetCloudSeedModalOpen(false)}
            onConfirm={async () => {
              await handleResetCloudSeed();
              setResetCloudSeedModalOpen(false);
            }}
          />
        </Suspense>
      )}
      {pullFriendConfigModalOpen && (
        <Suspense fallback={null}>
          <PullFriendConfigModalLazy
            isOpen={pullFriendConfigModalOpen}
            userId={pullFriendUserId}
            pulling={pullingFriendConfig}
            onChangeUserId={setPullFriendUserId}
            onClose={() => setPullFriendConfigModalOpen(false)}
            onSubmit={handlePullFriendConfig}
          />
        </Suspense>
      )}
      {releaseNotesOpen && (
        <Suspense fallback={null}>
          <ReleaseNotesDialogLazy isOpen={releaseNotesOpen} onClose={() => setReleaseNotesOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
