import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Button,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
  Tab,
  Tabs,
  Tooltip,
} from "@heroui/react";
import {
  Cloud,
  CloudDownload,
  FolderArchive,
  FolderOpen,
  Gamepad2,
  HardDrive,
  History,
  Info,
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
import { ask, open } from "@tauri-apps/plugin-dialog";
import { useGameMedia } from "@hooks/useGameMedia";
import type { ConfiguredGame } from "@app-types/config";

interface RestoreBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  game: ConfiguredGame | null;
  onSuccess?: () => void;
  /** Archivos remotos usuales → carpeta local. Solo con nube configurada. */
  onDownloadFromCloud?: (destinationPath?: string) => void | Promise<void>;
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
  const [failedCapsuleImage, setFailedCapsuleImage] = useState<string | null>(null);
  const hasCapsuleImage = Boolean(capsuleImage && failedCapsuleImage !== capsuleImage);

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
  const [destinationPath, setDestinationPath] = useState<string | null>(null);
  const [selectingDestination, setSelectingDestination] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDestinationPath(null);
    setSelectingDestination(false);
  }, [isOpen, gameId]);

  const cloudBusy = isDownloadingFromCloud || !!restoringCloudKey || !!deletingCloudKey;
  const canDownloadToDestination = Boolean(destinationPath || game?.paths.length);

  const handleSelectDestination = async () => {
    setSelectingDestination(true);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("library.restoreBackup.selectDestinationTitle"),
        ...(destinationPath ? { defaultPath: destinationPath } : {}),
      });
      if (typeof selected === "string" && selected.trim()) {
        setDestinationPath(selected);
      }
    } catch (error) {
      toastError(
        t("library.restoreBackup.destinationErrorTitle"),
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setSelectingDestination(false);
    }
  };

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
      await downloadAndRestoreFullBackup(gameId, b.key, destinationPath ?? undefined);
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
    <div className="space-y-2" role="status" aria-live="polite">
      <span className="sr-only">{t("common.loading")}</span>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="flex animate-pulse items-center gap-3 border-b border-divider px-2 py-3 last:border-0">
          <span className="size-9 shrink-0 rounded-lg bg-default-200/70 dark:bg-default-100/10" />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="block h-3 w-36 rounded bg-default-200/70 dark:bg-default-100/10" />
            <span className="block h-2.5 w-20 rounded bg-default-200/50 dark:bg-default-100/5" />
          </span>
          <span className="h-8 w-16 rounded-lg bg-default-200/70 dark:bg-default-100/10" />
        </div>
      ))}
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
          className="flex items-center justify-between gap-4 border-b border-divider px-2 py-3 transition-colors last:border-b-0 hover:bg-default-100/60">
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
        className="flex h-full flex-col rounded-2xl border border-divider bg-content1 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-default-100 text-primary dark:bg-content2">
            <CloudDownload size={22} strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-default-500">
              {t("library.restoreBackup.recommended")}
            </p>
            <h3 id="recover-primary-heading" className="mt-1 text-base font-semibold tracking-tight text-foreground">
              {t("library.restoreBackup.cloudFilesTitle")}
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-default-500">
              {t("library.restoreBackup.cloudFilesDesc")}
              <Tooltip
                content={t("library.restoreBackup.cloudFilesDetails")}
                placement="top"
                delay={300}
                classNames={{ content: "max-w-64 whitespace-normal text-wrap" }}>
                <button
                  type="button"
                  className="ml-1 inline-flex align-middle text-default-400 hover:text-default-600"
                  aria-label={t("library.restoreBackup.cloudFilesDetails")}>
                  <Info size={13} />
                </button>
              </Tooltip>
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <p id="restore-destination-label" className="text-xs font-medium text-default-600">
              {t("library.restoreBackup.destinationTitle")}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div
              id="restore-destination-path"
              aria-labelledby="restore-destination-label"
              className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-divider bg-default-100/50 px-3 dark:bg-content2"
              title={destinationPath ?? undefined}>
              <FolderOpen size={15} className="shrink-0 text-default-500" strokeWidth={1.75} />
              <span className="truncate text-xs text-default-700 dark:text-default-300">
                {destinationPath ??
                  (game?.paths.length
                    ? t("library.restoreBackup.destinationConfigured")
                    : t("library.restoreBackup.destinationRequired"))}
              </span>
            </div>
            <Button
              size="sm"
              variant="flat"
              className="h-10 shrink-0 font-medium"
              startContent={<FolderOpen size={15} />}
              onPress={() => void handleSelectDestination()}
              isLoading={selectingDestination}
              isDisabled={cloudBusy || creatingFullBackup || !!restoring || selectingDestination}>
              {destinationPath
                ? t("library.restoreBackup.changeDestination")
                : t("library.restoreBackup.chooseDestination")}
            </Button>
          </div>
          {destinationPath && (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="light"
                className="h-7 min-w-0 px-1 text-xs text-default-500"
                onPress={() => setDestinationPath(null)}
                isDisabled={selectingDestination || cloudBusy}>
                {t("library.restoreBackup.useGamePath")}
              </Button>
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-default-500">{t("library.restoreBackup.destinationHint")}</p>
        </div>

        <div className="mt-auto pt-6">
          <Button
            color="primary"
            variant="solid"
            className="h-11 w-full font-semibold shadow-sm"
            startContent={isDownloadingFromCloud ? <Spinner color="current" size="sm" /> : <CloudDownload size={18} />}
            onPress={() => void Promise.resolve(onDownloadFromCloud?.(destinationPath ?? undefined))}
            isDisabled={
              isDownloadingFromCloud ||
              restoring !== null ||
              cloudBusy ||
              creatingFullBackup ||
              selectingDestination ||
              !canDownloadToDestination
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
        size={hasCloudIntegration ? "4xl" : "2xl"}
        scrollBehavior="inside"
        backdrop="blur"
        classNames={{
          base: "max-h-[90dvh]",
          header: "border-b border-divider px-5 py-4 sm:px-6",
          body: "gap-5 px-5 py-5 sm:px-6",
          footer: "border-t border-divider px-5 py-3 sm:px-6",
        }}>
        <ModalContent>
          <ModalHeader className="flex items-center gap-3">
            {game && (
              <div className="size-12 shrink-0 overflow-hidden rounded-xl border border-divider bg-default-100">
                {hasCapsuleImage ? (
                  <img
                    src={capsuleImage ?? undefined}
                    alt=""
                    className="size-full object-cover"
                    onError={() => setFailedCapsuleImage(capsuleImage ?? null)}
                  />
                ) : (
                  <div className="flex size-full items-center justify-center bg-default-100 text-default-400 dark:bg-content2">
                    <Gamepad2 size={21} strokeWidth={1.6} />
                  </div>
                )}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-default-400">
                {t("library.restoreBackup.sectionLabel")}
              </span>
              <h2 className="mt-0.5 truncate text-lg font-bold tracking-tight text-foreground sm:text-xl">
                {t("library.restoreBackup.modalTitle")}
              </h2>
              <p className="truncate text-xs font-normal text-default-500">
                {game ? formatGameDisplayName(game.id) : t("library.restoreBackup.modalDesc")}
              </p>
            </div>
          </ModalHeader>

          <ModalBody
            className={
              primaryBlock
                ? "grid gap-5 lg:grid-cols-[minmax(16rem,0.9fr)_minmax(0,1.1fr)] lg:items-stretch lg:gap-6"
                : "gap-5"
            }>
            {!hasCloudIntegration && (
              <div className="flex items-start gap-2 rounded-xl border border-warning/20 bg-warning/10 px-4 py-3 text-xs text-warning-700 dark:text-warning-300">
                <Sparkles size={16} className="mt-0.5 shrink-0 text-warning" />
                <span>{t("library.restoreBackup.noCloudHint")}</span>
              </div>
            )}

            {primaryBlock}

            {hasCloudIntegration && (
              <section className="min-w-0 space-y-3">
                <div className="border-b border-divider pb-2">
                  <h3 className="text-sm font-semibold text-foreground">{t("library.restoreBackup.otherRecovery")}</h3>
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
                    <div className="space-y-3 pt-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs leading-relaxed text-default-600 dark:text-default-400">
                          {t("library.restoreBackup.snapshotsDesc")}
                          <Tooltip
                            content={t("library.restoreBackup.snapshotsDetails")}
                            placement="top"
                            delay={300}
                            classNames={{ content: "max-w-64 whitespace-normal text-wrap" }}>
                            <button
                              type="button"
                              className="ml-1 inline-flex align-middle text-default-400 hover:text-default-600"
                              aria-label={t("library.restoreBackup.snapshotsDetails")}>
                              <Info size={13} />
                            </button>
                          </Tooltip>
                        </p>
                        <Button
                          color="primary"
                          variant="flat"
                          size="sm"
                          className="shrink-0 font-semibold"
                          startContent={<Plus size={16} />}
                          onPress={handleCreateFullBackup}
                          isLoading={creatingFullBackup}
                          isDisabled={creatingFullBackup || isDownloadingFromCloud}>
                          {t("library.restoreBackup.createSnapshot")}
                        </Button>
                      </div>

                      {cloudLoading ? (
                        <div className="space-y-2" role="status" aria-live="polite">
                          <span className="sr-only">{t("common.loading")}</span>
                          {[0, 1, 2].map((index) => (
                            <div
                              key={index}
                              className="flex animate-pulse items-center gap-3 border-b border-divider px-2 py-3 last:border-0">
                              <span className="size-9 shrink-0 rounded-lg bg-default-200/70 dark:bg-default-100/10" />
                              <span className="min-w-0 flex-1 space-y-2">
                                <span className="block h-3 w-40 rounded bg-default-200/70 dark:bg-default-100/10" />
                                <span className="block h-2.5 w-24 rounded bg-default-200/50 dark:bg-default-100/5" />
                              </span>
                              <span className="h-8 w-16 rounded-lg bg-default-200/70 dark:bg-default-100/10" />
                            </div>
                          ))}
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
                              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-divider px-2 py-3 transition-colors last:border-b-0 hover:bg-default-100/60">
                              <div className="flex min-w-0 items-center gap-3">
                                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                  <Cloud size={18} strokeWidth={1.75} />
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-semibold text-foreground">{b.filename}</p>
                                  <p className="flex min-w-0 items-center gap-1 text-xs tabular-nums text-default-500">
                                    <span className="min-w-0 truncate" title={b.lastModified}>
                                      {b.lastModified}
                                    </span>
                                    {b.size != null && (
                                      <>
                                        <span aria-hidden="true" className="shrink-0">
                                          ·
                                        </span>
                                        <span className="shrink-0 whitespace-nowrap">{formatBytes(b.size)}</span>
                                      </>
                                    )}
                                  </p>
                                </div>
                              </div>

                              <div className="flex shrink-0 items-center gap-1">
                                <Button
                                  size="sm"
                                  color="primary"
                                  variant="flat"
                                  className="font-semibold"
                                  onPress={() => handleRestoreCloud(b)}
                                  isLoading={restoringCloudKey === b.key}
                                  isDisabled={
                                    !!restoringCloudKey ||
                                    !!deletingCloudKey ||
                                    selectingDestination ||
                                    !canDownloadToDestination
                                  }>
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
              </section>
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
