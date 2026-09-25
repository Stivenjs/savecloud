import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Button,
  Chip,
  Divider,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
  Tab,
  Tabs,
} from "@heroui/react";
import {
  Cloud,
  CloudDownload,
  FolderArchive,
  FolderOpen,
  HardDrive,
  History,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  listBackups,
  restoreBackup,
  createAndUploadFullBackup,
  listFullBackups,
  downloadAndRestoreFullBackup,
  deleteFullBackup,
  renameFullBackup,
  type BackupInfo,
  type CloudBackupInfo,
} from "@services/tauri";
import { formatGameDisplayName } from "@utils/gameImage";
import { formatBytes } from "@utils/format";
import { toastError, toastSuccess, toastSyncResult } from "@utils/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useSyncStore } from "@store/SyncStore";
import { ask } from "@tauri-apps/plugin-dialog";
import { useGameMedia } from "@hooks/useGameMedia";
import type { ConfiguredGame } from "@app-types/config";

interface RestoreBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  game: ConfiguredGame | null;
  onSuccess?: () => void;
  /** Archivos remotos usuales → carpeta local. Solo con nube configurada. */
  onDownloadFromCloud?: () => void | Promise<void>;
  isDownloadingFromCloud?: boolean;
  /** Si es false: solo backups locales en disco (sin llamadas a snapshots en nube). */
  hasCloudIntegration?: boolean;
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 6 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring" as const,
      stiffness: 300,
      damping: 25,
    },
  },
};

export function RestoreBackupModal({
  isOpen,
  onClose,
  game,
  onSuccess,
  onDownloadFromCloud,
  isDownloadingFromCloud = false,
  hasCloudIntegration = true,
}: RestoreBackupModalProps) {
  const { t } = useTranslation();
  const gameId = game?.id ?? "";
  const queryClient = useQueryClient();
  const setSyncOperation = useSyncStore((state) => state.setSyncOperation);

  const dummyGame: ConfiguredGame = game ?? { id: "", paths: [] };
  const { capsuleImage } = useGameMedia({
    game: dummyGame,
  });

  const { data: backups, isLoading } = useQuery({
    queryKey: ["backups", gameId],
    queryFn: () => listBackups(gameId),
    enabled: isOpen && !!gameId,
  });

  const {
    data: cloudBackups,
    isLoading: cloudLoading,
    refetch: refetchCloudBackups,
  } = useQuery({
    queryKey: ["cloud-backups", gameId],
    queryFn: () => listFullBackups(gameId),
    enabled: isOpen && !!gameId && hasCloudIntegration,
  });

  useEffect(() => {
    if (!isOpen) return;
    const unsub = listen("full-backup-done", () => {
      queryClient.invalidateQueries({ queryKey: ["cloud-backups", gameId] });
      queryClient.invalidateQueries({ queryKey: ["cloud-backup-counts"] });
    });
    return () => {
      unsub.then((f) => f());
    };
  }, [isOpen, gameId, queryClient]);

  const [restoring, setRestoring] = useState<string | null>(null);
  const [creatingFullBackup, setCreatingFullBackup] = useState(false);
  const [restoringCloudKey, setRestoringCloudKey] = useState<string | null>(null);
  const [deletingCloudKey, setDeletingCloudKey] = useState<string | null>(null);
  const [renamingBackup, setRenamingBackup] = useState<CloudBackupInfo | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  const cloudBusy = isDownloadingFromCloud || !!restoringCloudKey || !!deletingCloudKey;

  const handleRestore = async (backup: BackupInfo) => {
    if (!gameId || !game) return;
    setRestoring(backup.id);
    try {
      const result = await restoreBackup(gameId, backup.id);
      toastSyncResult(result, formatGameDisplayName(game.id));
      onSuccess?.();
      onClose();
    } catch (e) {
      toastSyncResult(
        {
          okCount: 0,
          errCount: 1,
          errors: [e instanceof Error ? e.message : String(e)],
        },
        formatGameDisplayName(game.id)
      );
    } finally {
      setRestoring(null);
    }
  };

  const handleCreateFullBackup = async () => {
    if (!gameId || !game) return;
    setCreatingFullBackup(true);
    setSyncOperation({ type: "upload", mode: "single", gameId, operationId: `sync-upload-${gameId}` });
    try {
      await createAndUploadFullBackup(gameId);
      toastSuccess(t("library.restoreBackup.fullBackupCreatedTitle"), t("library.restoreBackup.fullBackupCreatedDesc"));
      await refetchCloudBackups();
    } catch (e) {
      toastError(t("library.restoreBackup.createBackupError"), e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingFullBackup(false);
    }
  };

  const handleRestoreCloud = async (b: CloudBackupInfo) => {
    if (!gameId || !game) return;
    setRestoringCloudKey(b.key);
    setSyncOperation({ type: "download", mode: "single", gameId, operationId: `sync-download-${gameId}` });
    try {
      await downloadAndRestoreFullBackup(gameId, b.key);
      toastSuccess(
        t("library.restoreBackup.restoreCompleteTitle"),
        t("library.restoreBackup.restoreCompleteDesc", { filename: b.filename })
      );
      onSuccess?.();
      onClose();
    } catch (e) {
      toastError(t("library.restoreBackup.restoreError"), e instanceof Error ? e.message : String(e));
    } finally {
      setRestoringCloudKey(null);
    }
  };

  const handleDeleteCloud = async (b: CloudBackupInfo) => {
    if (!gameId || !game) return;
    const confirmed = await ask(t("library.restoreBackup.deleteConfirm", { filename: b.filename }), {
      title: t("library.restoreBackup.deleteTitle"),
      kind: "warning",
      okLabel: t("common.confirm"),
      cancelLabel: t("common.cancel"),
    });
    if (!confirmed) return;
    setDeletingCloudKey(b.key);
    try {
      await deleteFullBackup(gameId, b.key);
      toastSuccess(t("library.restoreBackup.deleteSuccessTitle"), t("library.restoreBackup.deleteSuccessDesc"));
      queryClient.invalidateQueries({ queryKey: ["cloud-backups", gameId] });
      queryClient.invalidateQueries({ queryKey: ["cloud-backup-counts"] });
    } catch (e) {
      toastError(t("library.restoreBackup.deleteError"), e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingCloudKey(null);
    }
  };

  const openRenameModal = (b: CloudBackupInfo) => {
    setRenamingBackup(b);
    setRenameValue(b.filename);
  };

  const handleRenameSubmit = async () => {
    if (!gameId || !renamingBackup) return;
    const name = renameValue.trim();
    if (!name.endsWith(".tar")) {
      toastError(t("library.restoreBackup.invalidNameTitle"), t("library.restoreBackup.invalidNameTar"));
      return;
    }
    if (name.includes("/") || name.includes("..")) {
      toastError(t("library.restoreBackup.invalidNameTitle"), t("library.restoreBackup.invalidNamePath"));
      return;
    }
    setIsRenaming(true);
    try {
      await renameFullBackup(gameId, renamingBackup.key, name);
      toastSuccess(
        t("library.restoreBackup.renameSuccessTitle"),
        t("library.restoreBackup.renameSuccessDesc", { name })
      );
      setRenamingBackup(null);
      queryClient.invalidateQueries({ queryKey: ["cloud-backups", gameId] });
    } catch (e) {
      toastError(t("library.restoreBackup.renameError"), e instanceof Error ? e.message : String(e));
    } finally {
      setIsRenaming(false);
    }
  };

  const localBackupList = isLoading ? (
    <div className="flex items-center justify-center py-10">
      <Spinner size="lg" color="primary" />
    </div>
  ) : !backups?.length ? (
    <div className="rounded-xl border border-dashed border-default-300 bg-default-50/50 p-6 text-center dark:border-default-100/20 dark:bg-default-100/10">
      <FolderArchive className="mx-auto mb-2 size-10 text-default-400" aria-hidden strokeWidth={1.25} />
      <p className="text-sm font-semibold text-foreground">{t("library.restoreBackup.noLocalBackupsTitle")}</p>
      <p className="mt-1 max-w-[50ch] mx-auto text-xs leading-relaxed text-default-500">
        {t("library.restoreBackup.noLocalBackupsDesc")}
      </p>
    </div>
  ) : (
    <motion.ul
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="max-h-[min(16rem,50vh)] space-y-2 overflow-y-auto pr-1">
      {backups.map((b: BackupInfo) => (
        <motion.li
          key={b.id}
          variants={itemVariants}
          className="flex items-center justify-between gap-4 rounded-xl border border-divider bg-content2 px-4 py-3 shadow-xs transition-colors hover:bg-content3/60">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-default-100 text-default-600 dark:bg-default-50/10">
              <HardDrive size={18} strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold tabular-nums text-foreground">{b.createdAt}</p>
              <p className="text-xs text-default-500 font-medium">
                {t("library.restoreBackup.fileCount", { count: b.fileCount })}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            color="primary"
            variant="flat"
            className="shrink-0 font-semibold"
            onPress={() => handleRestore(b)}
            isLoading={restoring === b.id}
            isDisabled={!!restoring || isDownloadingFromCloud}>
            {t("library.restoreBackup.apply")}
          </Button>
        </motion.li>
      ))}
    </motion.ul>
  );

  const primaryBlock =
    onDownloadFromCloud && hasCloudIntegration ? (
      <section
        aria-labelledby="recover-primary-heading"
        className="rounded-xl border border-primary/30 bg-primary-50/40 dark:bg-primary-500/10 p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <Chip
                size="sm"
                color="primary"
                variant="flat"
                className="font-semibold text-[10px] tracking-wider uppercase">
                {t("library.restoreBackup.recommended")}
              </Chip>
            </div>
            <h3 id="recover-primary-heading" className="text-base font-bold tracking-tight text-foreground">
              {t("library.restoreBackup.cloudFilesTitle")}
            </h3>
            <p className="max-w-[65ch] text-xs leading-relaxed text-default-600 dark:text-default-400">
              {t("library.restoreBackup.cloudFilesDesc")}
            </p>
          </div>

          <Button
            color="primary"
            variant="solid"
            className="font-semibold shrink-0 w-full sm:w-auto sm:min-w-44 shadow-xs"
            startContent={
              isDownloadingFromCloud ? (
                <Spinner color="current" size="sm" />
              ) : (
                <CloudDownload size={18} className="shrink-0" />
              )
            }
            onPress={() => void Promise.resolve(onDownloadFromCloud?.())}
            isDisabled={
              isDownloadingFromCloud || restoring !== null || cloudBusy || creatingFullBackup || !!restoringCloudKey
            }>
            {isDownloadingFromCloud
              ? t("library.restoreBackup.downloading")
              : t("library.restoreBackup.downloadAndApply")}
          </Button>
        </div>
      </section>
    ) : null;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onOpenChange={(o) => !o && onClose()}
        size="2xl"
        scrollBehavior="inside"
        backdrop="blur"
        classNames={{
          header: "border-b border-divider pb-4",
          footer: "border-t border-divider pt-3 pb-3",
        }}>
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-default-400">
              {t("library.restoreBackup.sectionLabel")}
            </span>
            <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              {t("library.restoreBackup.modalTitle")}
            </h2>
            <p className="text-xs text-default-500 font-normal">{t("library.restoreBackup.modalDesc")}</p>
          </ModalHeader>

          <ModalBody className="gap-6 py-5">
            {game && (
              <div className="flex items-center gap-4 rounded-xl border border-divider bg-content2 p-3.5 shadow-xs">
                <div className="h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-default-100 border border-default-200/80 dark:border-default-100/10 relative">
                  {capsuleImage ? (
                    <img src={capsuleImage} alt="" className="w-full h-full object-cover object-center" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-default-400">
                      <FolderOpen size={22} strokeWidth={1.5} />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-base text-foreground truncate">{formatGameDisplayName(game.id)}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-mono text-[11px] text-default-500 bg-default-100 dark:bg-default-50/10 px-2 py-0.5 rounded border border-default-200/60 dark:border-default-100/10 tabular-nums">
                      {game.id}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {!hasCloudIntegration && (
              <div className="rounded-xl border border-warning-200/80 bg-warning-50/50 dark:border-warning-500/30 dark:bg-warning-500/10 px-4 py-3 text-xs text-warning-700 dark:text-warning-300 flex items-center gap-2">
                <Sparkles size={16} className="shrink-0 text-warning" />
                <span>{t("library.restoreBackup.noCloudHint")}</span>
              </div>
            )}

            {primaryBlock}

            {hasCloudIntegration && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Divider className="flex-1" />
                  <span className="shrink-0 text-[0.65rem] font-bold uppercase tracking-[0.14em] text-default-400">
                    {t("library.restoreBackup.otherRecovery")}
                  </span>
                  <Divider className="flex-1" />
                </div>

                <Tabs
                  aria-label={t("library.restoreBackup.tabsAriaLabel")}
                  fullWidth
                  variant="solid"
                  classNames={{
                    tabList: "w-full gap-1 rounded-xl bg-default-100 dark:bg-default-100/50 border border-divider p-1",
                    cursor: "bg-background dark:bg-content1 shadow-xs rounded-lg",
                    tab: "h-10 text-xs font-semibold data-[selected=true]:text-foreground text-default-500 transition-colors",
                  }}>
                  <Tab
                    key="local"
                    title={
                      <span className="flex items-center justify-center gap-2">
                        <FolderArchive size={16} strokeWidth={1.75} />
                        <span>{t("library.restoreBackup.localCopiesTab")}</span>
                        {backups && backups.length > 0 && (
                          <Chip
                            size="sm"
                            variant="flat"
                            color="default"
                            className="h-5 px-1.5 min-w-5 text-[10px] font-mono">
                            {backups.length}
                          </Chip>
                        )}
                      </span>
                    }>
                    <div className="pt-4">{localBackupList}</div>
                  </Tab>
                  <Tab
                    key="tar"
                    title={
                      <span className="flex items-center justify-center gap-2">
                        <History size={16} strokeWidth={1.75} />
                        <span className="hidden xs:inline">{t("library.restoreBackup.remoteSnapshotsTab")}</span>
                        <span className="xs:hidden">{t("library.restoreBackup.remoteSnapshotsShort")}</span>
                        {cloudBackups && cloudBackups.length > 0 && (
                          <Chip
                            size="sm"
                            variant="flat"
                            color="primary"
                            className="h-5 px-1.5 min-w-5 text-[10px] font-mono">
                            {cloudBackups.length}
                          </Chip>
                        )}
                      </span>
                    }>
                    <div className="space-y-4 pt-4">
                      <p className="text-xs leading-relaxed text-default-600 dark:text-default-400">
                        {t("library.restoreBackup.snapshotsDesc")}
                      </p>

                      <Button
                        color="primary"
                        variant="flat"
                        size="sm"
                        className="font-semibold"
                        startContent={<Plus size={16} />}
                        onPress={handleCreateFullBackup}
                        isLoading={creatingFullBackup}
                        isDisabled={creatingFullBackup || isDownloadingFromCloud}>
                        {t("library.restoreBackup.createSnapshot")}
                      </Button>

                      {cloudLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Spinner size="lg" color="primary" />
                        </div>
                      ) : !cloudBackups?.length ? (
                        <div className="rounded-xl border border-dashed border-default-300 bg-default-50/50 p-6 text-center dark:border-default-100/20 dark:bg-default-100/10">
                          <History className="mx-auto mb-2 size-8 text-default-400" strokeWidth={1.25} />
                          <p className="text-xs font-semibold text-foreground">
                            {t("library.restoreBackup.noCloudSnapshots")}
                          </p>
                        </div>
                      ) : (
                        <motion.ul
                          variants={containerVariants}
                          initial="hidden"
                          animate="show"
                          className="max-h-[min(15rem,45vh)] space-y-2 overflow-y-auto pr-1">
                          {cloudBackups.map((b: CloudBackupInfo) => (
                            <motion.li
                              key={b.key}
                              variants={itemVariants}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-divider bg-content2 px-4 py-3 shadow-xs transition-colors hover:bg-content3/60">
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                  <Cloud size={18} strokeWidth={1.75} />
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-semibold text-foreground">{b.filename}</p>
                                  <p className="text-xs tabular-nums text-default-500">
                                    {b.lastModified}
                                    {b.size != null ? ` • ${formatBytes(b.size)}` : ""}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  color="primary"
                                  variant="flat"
                                  className="font-semibold"
                                  onPress={() => handleRestoreCloud(b)}
                                  isLoading={restoringCloudKey === b.key}
                                  isDisabled={!!restoringCloudKey || !!deletingCloudKey}>
                                  {t("library.restoreBackup.restore")}
                                </Button>
                                <Button
                                  size="sm"
                                  isIconOnly
                                  variant="light"
                                  aria-label={t("library.restoreBackup.renameBackup")}
                                  onPress={() => openRenameModal(b)}
                                  isDisabled={!!restoringCloudKey || !!deletingCloudKey}>
                                  <Pencil size={16} className="text-default-600" />
                                </Button>
                                <Button
                                  size="sm"
                                  isIconOnly
                                  variant="light"
                                  color="danger"
                                  aria-label={t("library.restoreBackup.deleteBackup")}
                                  onPress={() => handleDeleteCloud(b)}
                                  isLoading={deletingCloudKey === b.key}
                                  isDisabled={
                                    !!restoringCloudKey || (!!deletingCloudKey && deletingCloudKey !== b.key)
                                  }>
                                  <Trash2 size={16} />
                                </Button>
                              </div>
                            </motion.li>
                          ))}
                        </motion.ul>
                      )}
                    </div>
                  </Tab>
                </Tabs>
              </div>
            )}

            {!hasCloudIntegration && (
              <div className="space-y-3">
                <h3 className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-default-400">
                  {t("library.restoreBackup.localCopiesHeading")}
                </h3>
                {localBackupList}
              </div>
            )}
          </ModalBody>

          <ModalFooter>
            <Button variant="flat" onPress={onClose}>
              {t("common.close")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={!!renamingBackup}
        onOpenChange={(open) => !open && setRenamingBackup(null)}
        size="md"
        backdrop="blur">
        <ModalContent>
          <ModalHeader className="border-b border-divider pb-3">
            {t("library.restoreBackup.renameModalTitle")}
          </ModalHeader>
          <ModalBody className="py-4 space-y-3">
            <p
              className="text-xs text-default-500 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: t("library.restoreBackup.renameModalHint") }}
            />
            <Input
              label={t("library.restoreBackup.newNameLabel")}
              value={renameValue}
              onValueChange={setRenameValue}
              placeholder={t("library.restoreBackup.newNamePlaceholder")}
            />
          </ModalBody>
          <ModalFooter className="border-t border-divider pt-3">
            <Button variant="flat" onPress={() => setRenamingBackup(null)} isDisabled={isRenaming}>
              {t("common.cancel")}
            </Button>
            <Button color="primary" onPress={handleRenameSubmit} isLoading={isRenaming} isDisabled={isRenaming}>
              {t("common.save")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
