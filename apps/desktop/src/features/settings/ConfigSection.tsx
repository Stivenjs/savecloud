import { Button, Card, CardBody, Divider, Progress, Skeleton, Tab, Tabs } from "@heroui/react";
import { SteamSeedFreshnessBanner } from "@features/steam-catalog/components/SteamSeedFreshnessBanner";
import { FileJson, Cloud, HardDrive, FolderOpen, Link2, Library, Zap } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import type { SteamCatalogSyncProgressPayload, SteamSeedImportProgressPayload } from "@services/tauri";
import type { ReactNode } from "react";

interface ConfigSectionProps {
  exporting: boolean;
  importing: boolean;
  backingUpConfig: boolean;
  restoringConfig: boolean;
  configPath: string;
  userId?: string | null;
  /** True si hay clave Steam Web API (valor enmascarado desde get_config). */
  hasSteamWebApiKey?: boolean;
  /** "accelerated" = S3 Transfer Acceleration activo; "standard" = endpoint estándar; "unknown" o null = no comprobado. */
  s3TransferEndpointType?: "accelerated" | "standard" | "unknown" | null;
  /** Indica si la información principal aún se está cargando (útil para skeletons) */
  isLoadingData?: boolean;
  steamCatalogBusy?: boolean;
  steamSeedBusy?: boolean;
  steamCatalogSyncProgress?: SteamCatalogSyncProgressPayload | null;
  steamSeedImportProgress?: SteamSeedImportProgressPayload | null;
  onCreateConfig: () => void;
  onExport: () => void | Promise<void>;
  onImportMerge: () => void | Promise<void>;
  onImportReplace: () => void | Promise<void>;
  onPullFriendConfig: () => void | Promise<void>;
  onBackupToCloud: () => void | Promise<void>;
  onRestoreFromCloud: () => void | Promise<void>;
  onSyncSteamCatalog?: () => void | Promise<void>;
  onResetSteamCatalogSync?: () => void | Promise<void>;
  onExportSteamSeedManifest?: () => void | Promise<void>;
  onResetCloudSeedState?: () => void | Promise<void>;
  onImportCloudSeedFromCloud?: () => void | Promise<void>;
  /** Controla la visibilidad del modal de reinicio de cloud seed */
  isResetCloudSeedModalOpen?: boolean;
  /** Abre el modal de reinicio de cloud seed */
  onOpenResetCloudSeedModal?: () => void;
}

const sectionClass =
  "rounded-xl border border-default-200/70 bg-default-50/40 p-4 dark:border-default-100/15 dark:bg-default-100/5";
const buttonClass = "font-medium transition-transform duration-200 active:scale-[0.98]";
const labelClass = "text-xs font-semibold uppercase tracking-[0.08em] text-default-500";
const sectionShellClass = sectionClass;
const sectionInnerClass = "space-y-4";
const actionButtonClass = buttonClass;

interface SectionHeaderProps {
  id: string;
  icon: ReactNode;
  eyebrow: string;
  title: string;
  description?: string;
}

function SectionHeader({ id, icon, eyebrow, title, description }: SectionHeaderProps) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0 text-default-500">{icon}</span>
      <div className="min-w-0">
        <p className={labelClass}>{eyebrow}</p>
        <h3 id={id} className="mt-1 text-sm font-semibold text-foreground">
          {title}
        </h3>
        {description ? <p className="mt-1 max-w-2xl text-sm leading-relaxed text-default-600">{description}</p> : null}
      </div>
    </div>
  );
}

interface ProgressStatusProps {
  ariaLabel: string;
  message: string;
}

function ProgressStatus({ ariaLabel, message }: ProgressStatusProps) {
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-default-200/80 bg-content1/70 px-3 py-2 dark:border-default-100/15">
      <Progress size="sm" isIndeterminate aria-label={ariaLabel} classNames={{ track: "h-1.5" }} />
      <p className="text-xs text-default-500">{message}</p>
    </div>
  );
}

export function ConfigSection({
  exporting,
  importing,
  backingUpConfig,
  restoringConfig,
  configPath,
  userId,
  hasSteamWebApiKey = false,
  s3TransferEndpointType,
  isLoadingData = false,
  steamCatalogBusy = false,
  steamSeedBusy = false,
  steamCatalogSyncProgress = null,
  steamSeedImportProgress = null,
  onCreateConfig,
  onExport,
  onImportMerge,
  onImportReplace,
  onPullFriendConfig,
  onBackupToCloud,
  onRestoreFromCloud,
  onSyncSteamCatalog,
  onResetSteamCatalogSync,
  onExportSteamSeedManifest,
  onImportCloudSeedFromCloud,
  onOpenResetCloudSeedModal,
}: ConfigSectionProps) {
  const { t } = useTranslation();
  const showS3TransferBlock = isLoadingData || (s3TransferEndpointType != null && s3TransferEndpointType !== "unknown");

  return (
    <Card className="border border-default-200/70 shadow-sm dark:border-default-100/15">
      <CardBody className="flex flex-col gap-0 p-5">
        <div className="flex flex-col gap-4 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 text-primary">
              <FileJson size={22} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">{t("settings.configSection.title")}</h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-default-600">
                {t("settings.configSection.subtitle")}
              </p>
            </div>
          </div>

          {showS3TransferBlock ? (
            <div className="shrink-0">
              {isLoadingData ? (
                <Skeleton className="h-9 w-44 rounded-lg" />
              ) : (
                <div className="inline-flex items-center gap-2 rounded-lg border border-default-200 bg-default-50/60 px-3 py-2 dark:border-default-100/15 dark:bg-default-100/5">
                  <Zap size={16} className="text-warning" />
                  <span className="text-xs text-default-600">
                    S3:{" "}
                    <strong className="font-semibold text-foreground">
                      {s3TransferEndpointType === "accelerated"
                        ? t("settings.configSection.s3Accelerated")
                        : t("settings.configSection.s3Standard")}
                    </strong>
                  </span>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <Divider className="my-4" />

        <Tabs
          aria-label={t("settings.configSection.tabsAriaLabel")}
          variant="underlined"
          color="primary"
          classNames={{
            tabList: "gap-4 w-full border-b border-default-200 dark:border-default-100/15",
            tab: "h-10 px-0 text-xs data-[selected=true]:font-semibold",
            tabContent: "group-data-[selected=true]:text-foreground",
            panel: "pt-4",
          }}>
          <Tab key="identity" title={t("settings.configSection.tabIdentity")}>
            <div className="grid gap-4 lg:grid-cols-[1.35fr_0.85fr]">
              <section aria-labelledby="config-path-user" className={sectionShellClass}>
                <div className={sectionInnerClass}>
                  <SectionHeader
                    id="config-path-user"
                    icon={<FolderOpen size={18} />}
                    eyebrow={t("settings.configSection.identityEyebrow")}
                    title={t("settings.configSection.identityTitle")}
                    description={t("settings.configSection.identityDesc")}
                  />

                  <div className="mt-4 rounded-xl border border-default-200/70 bg-default-50/55 p-3 dark:border-default-100/15 dark:bg-default-50/10">
                    {isLoadingData ? (
                      <Skeleton className="h-4 w-full max-w-xl rounded-lg" />
                    ) : configPath ? (
                      <p className="break-all font-mono text-xs leading-relaxed text-default-600">{configPath}</p>
                    ) : (
                      <p className="text-xs italic text-default-400">{t("settings.configSection.pathUnavailable")}</p>
                    )}

                    <p className="mt-2 text-xs text-default-500">
                      <Trans
                        i18nKey="settings.configSection.readsConfigOnly"
                        components={{ code: <code className="rounded bg-default-200 px-1" /> }}
                      />
                    </p>
                  </div>

                  <div className="mt-4 rounded-xl border border-default-200/70 bg-content1/70 p-3 dark:border-default-100/15">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-xs font-medium text-default-500">
                        {t("settings.configSection.userLabel")}
                      </span>
                      {isLoadingData ? (
                        <Skeleton className="h-4 w-32 rounded-lg" />
                      ) : userId ? (
                        <span className="font-mono text-sm text-foreground">{userId}</span>
                      ) : (
                        <span className="text-xs text-default-400 italic">
                          {t("settings.configSection.notConfigured")}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 flex items-start gap-1.5 text-xs text-default-500">
                      <Link2 size={14} className="mt-0.5 shrink-0 text-default-400" />
                      {t("settings.configSection.shareProfileHint")}
                    </p>
                  </div>
                </div>
              </section>

              <section aria-labelledby="config-cloud-link" className={sectionShellClass}>
                <div className={`${sectionInnerClass} flex h-full flex-col justify-between gap-5`}>
                  <SectionHeader
                    id="config-cloud-link"
                    icon={<Cloud size={18} />}
                    eyebrow={t("settings.configSection.cloudEyebrow")}
                    title={t("settings.configSection.cloudTitle")}
                    description={t("settings.configSection.cloudDesc")}
                  />
                  <Button
                    size="sm"
                    variant="flat"
                    color="primary"
                    onPress={onCreateConfig}
                    startContent={<Cloud size={16} />}
                    className={`${actionButtonClass} w-fit`}>
                    {t("settings.configSection.configureConnection")}
                  </Button>
                </div>
              </section>
            </div>
          </Tab>

          <Tab key="steam" title={t("settings.configSection.tabSteam")}>
            <div className="grid gap-4 xl:grid-cols-2">
              <section aria-labelledby="config-steam-catalog" className={sectionShellClass}>
                <div className={`${sectionInnerClass} space-y-4`}>
                  <SectionHeader
                    id="config-steam-catalog"
                    icon={<Library size={18} />}
                    eyebrow={t("settings.configSection.catalogEyebrow")}
                    title={t("settings.configSection.catalogTitle")}
                    description={t("settings.configSection.catalogDesc")}
                  />

                  <div className="rounded-xl border border-default-200/70 bg-default-50/55 px-3 py-2.5 dark:border-default-100/15 dark:bg-default-50/10">
                    <span className="text-xs font-medium text-default-500">
                      {t("settings.configSection.steamKeyLabel")}
                    </span>
                    {isLoadingData ? (
                      <Skeleton className="mt-1 h-4 w-40 rounded-lg" />
                    ) : (
                      <p className="mt-1 text-sm font-medium text-foreground">
                        {hasSteamWebApiKey ? (
                          <span className="text-success-600">{t("settings.configSection.steamKeyConfigured")}</span>
                        ) : (
                          <span className="italic text-default-400">{t("settings.configSection.steamKeyMissing")}</span>
                        )}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="flat"
                      color="secondary"
                      isDisabled={!hasSteamWebApiKey || steamCatalogBusy}
                      isLoading={steamCatalogBusy}
                      onPress={() => onSyncSteamCatalog?.()}
                      className={actionButtonClass}>
                      {t("settings.configSection.syncCatalogNow")}
                    </Button>
                    <Button
                      size="sm"
                      variant="light"
                      color="warning"
                      isDisabled={steamCatalogBusy}
                      onPress={() => onResetSteamCatalogSync?.()}
                      className={actionButtonClass}>
                      {t("settings.configSection.resetCatalogSync")}
                    </Button>
                  </div>

                  {steamCatalogBusy ? (
                    <ProgressStatus
                      ariaLabel={t("settings.configSection.catalogProgressAria")}
                      message={
                        steamCatalogSyncProgress
                          ? steamCatalogSyncProgress.done
                            ? t("settings.configSection.catalogDone")
                            : t("settings.configSection.catalogStep", {
                                batch: steamCatalogSyncProgress.batch,
                                count: steamCatalogSyncProgress.appsUpserted.toLocaleString(),
                              })
                          : t("settings.configSection.catalogConnecting")
                      }
                    />
                  ) : null}
                </div>
              </section>

              <section aria-labelledby="config-steam-seed" className={sectionShellClass}>
                <div className={`${sectionInnerClass} space-y-4`}>
                  <SectionHeader
                    id="config-steam-seed"
                    icon={<Cloud size={18} />}
                    eyebrow={t("settings.configSection.seedEyebrow")}
                    title={t("settings.configSection.seedTitle")}
                    description={t("settings.configSection.seedDesc")}
                  />
                  <SteamSeedFreshnessBanner />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="flat"
                      color="primary"
                      isDisabled={steamSeedBusy}
                      isLoading={steamSeedBusy}
                      onPress={() => onExportSteamSeedManifest?.()}
                      className={actionButtonClass}>
                      {t("settings.configSection.sendGameList")}
                    </Button>
                    <Button
                      size="sm"
                      variant="flat"
                      color="secondary"
                      isDisabled={steamSeedBusy}
                      onPress={() => onImportCloudSeedFromCloud?.()}
                      className={actionButtonClass}>
                      {t("settings.configSection.downloadDetailedInfo")}
                    </Button>
                    <Button
                      size="sm"
                      variant="light"
                      color="warning"
                      isDisabled={steamSeedBusy}
                      onPress={() => onOpenResetCloudSeedModal?.()}
                      className={actionButtonClass}>
                      {t("settings.configSection.resetCloudSeed")}
                    </Button>
                  </div>
                  {steamSeedBusy ? (
                    <ProgressStatus
                      ariaLabel={t("settings.configSection.seedProgressAria")}
                      message={
                        steamSeedImportProgress
                          ? steamSeedImportProgress.done
                            ? t("settings.configSection.seedFinishing")
                            : t("settings.configSection.seedPass", {
                                iteration: steamSeedImportProgress.iteration,
                                batches: steamSeedImportProgress.totalBatches,
                                count: steamSeedImportProgress.totalRowsUpdated.toLocaleString(),
                              })
                          : t("settings.configSection.seedPreparing")
                      }
                    />
                  ) : null}
                </div>
              </section>
            </div>
          </Tab>

          <Tab key="backups" title={t("settings.configSection.tabBackups")}>
            <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <section aria-labelledby="config-local-files" className={sectionShellClass}>
                <div className={`${sectionInnerClass} space-y-4`}>
                  <SectionHeader
                    id="config-local-files"
                    icon={<HardDrive size={18} />}
                    eyebrow={t("settings.configSection.localFilesEyebrow")}
                    title={t("settings.configSection.localFilesTitle")}
                    description={t("settings.configSection.localFilesDesc")}
                  />
                  <div className="grid gap-2 text-xs text-default-500 sm:grid-cols-2">
                    <p className="rounded-xl border border-default-200/60 bg-default-50/50 px-3 py-2 dark:border-default-100/15 dark:bg-default-50/10">
                      <Trans
                        i18nKey="settings.configSection.exportHint"
                        components={{ strong: <strong className="text-default-600" /> }}
                      />
                    </p>
                    <p className="rounded-xl border border-default-200/60 bg-default-50/50 px-3 py-2 dark:border-default-100/15 dark:bg-default-50/10">
                      <Trans
                        i18nKey="settings.configSection.mergeHint"
                        components={{ strong: <strong className="text-default-600" /> }}
                      />
                    </p>
                    <p className="rounded-xl border border-default-200/60 bg-default-50/50 px-3 py-2 dark:border-default-100/15 dark:bg-default-50/10">
                      <Trans
                        i18nKey="settings.configSection.replaceHint"
                        components={{ strong: <strong className="text-default-600" /> }}
                      />
                    </p>
                    <p className="rounded-xl border border-default-200/60 bg-default-50/50 px-3 py-2 dark:border-default-100/15 dark:bg-default-50/10">
                      <Trans
                        i18nKey="settings.configSection.importUserHint"
                        components={{ strong: <strong className="text-default-600" /> }}
                      />
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="flat"
                      onPress={onExport}
                      isLoading={exporting}
                      className={actionButtonClass}>
                      {t("settings.configSection.export")}
                    </Button>
                    <Button
                      size="sm"
                      variant="flat"
                      onPress={onImportMerge}
                      isLoading={importing}
                      className={actionButtonClass}>
                      {t("settings.configSection.importMerge")}
                    </Button>
                    <Button
                      size="sm"
                      variant="flat"
                      color="warning"
                      onPress={onImportReplace}
                      isLoading={importing}
                      className={actionButtonClass}>
                      {t("settings.configSection.importReplace")}
                    </Button>
                    <Button
                      size="sm"
                      variant="flat"
                      color="secondary"
                      onPress={onPullFriendConfig}
                      className={actionButtonClass}>
                      {t("settings.configSection.importFromUser")}
                    </Button>
                  </div>
                </div>
              </section>

              <section aria-labelledby="config-cloud-backup" className={sectionShellClass}>
                <div className={`${sectionInnerClass} flex h-full flex-col justify-between gap-5`}>
                  <SectionHeader
                    id="config-cloud-backup"
                    icon={<Cloud size={18} />}
                    eyebrow={t("settings.configSection.remoteBackupEyebrow")}
                    title={t("settings.configSection.remoteBackupTitle")}
                    description={t("settings.configSection.remoteBackupDesc")}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="flat"
                      color="primary"
                      onPress={onBackupToCloud}
                      isLoading={backingUpConfig}
                      className={actionButtonClass}>
                      {t("settings.configSection.backupToCloud")}
                    </Button>
                    <Button
                      size="sm"
                      variant="flat"
                      color="secondary"
                      onPress={onRestoreFromCloud}
                      isLoading={restoringConfig}
                      className={actionButtonClass}>
                      {t("settings.configSection.restoreFromCloud")}
                    </Button>
                  </div>
                </div>
              </section>
            </div>
          </Tab>
        </Tabs>
      </CardBody>
    </Card>
  );
}
