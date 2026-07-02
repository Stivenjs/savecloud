import {
  Button,
  Card,
  CardBody,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
} from "@heroui/react";
import { Archive, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cleanupOldBackups, setKeepBackupsPerGame, deleteAllLocalBackups } from "@services/tauri/config.service";
import { toastError, toastSuccess } from "@utils/toast";
import { useConfig } from "@hooks/useConfig";

const KEEP_OPTIONS = [3, 5, 10, 20] as const;
const DEFAULT_KEEP = 10;

export function LocalBackupInfoCard() {
  const { t } = useTranslation();
  const { config, refetch } = useConfig();
  const [keepLastN, setKeepLastN] = useState(DEFAULT_KEEP);
  const [cleaning, setCleaning] = useState(false);
  const [isDeleteAllModalOpen, setIsDeleteAllModalOpen] = useState(false);

  useEffect(() => {
    const n = config?.keepBackupsPerGame ?? DEFAULT_KEEP;
    setKeepLastN(KEEP_OPTIONS.includes(n as (typeof KEEP_OPTIONS)[number]) ? n : DEFAULT_KEEP);
  }, [config?.keepBackupsPerGame]);

  const handleCleanup = async () => {
    setCleaning(true);
    try {
      const result = await cleanupOldBackups(keepLastN);
      if (result.backupsDeleted > 0) {
        toastSuccess(
          t("settings.localBackup.toastSpaceFreed"),
          t("settings.localBackup.toastSpaceFreedDesc", {
            count: result.backupsDeleted,
            games: result.gamesAffected,
            keep: keepLastN,
          })
        );
      } else {
        toastSuccess(
          t("settings.localBackup.toastNoChanges"),
          t("settings.localBackup.toastNoChangesDesc", { keep: keepLastN })
        );
      }
    } catch (e) {
      toastError(t("settings.localBackup.toastCleanupError"), e instanceof Error ? e.message : String(e));
    } finally {
      setCleaning(false);
    }
  };

  const handleDeleteAllBackups = async () => {
    setCleaning(true);
    try {
      await deleteAllLocalBackups();
      toastSuccess(t("settings.localBackup.toastDeletedAll"), t("settings.localBackup.toastDeletedAllDesc"));
      setIsDeleteAllModalOpen(false);
    } catch (e) {
      toastError(t("settings.localBackup.toastDeleteError"), e instanceof Error ? e.message : String(e));
    } finally {
      setCleaning(false);
    }
  };

  return (
    <Card className="bg-default-50">
      <CardBody className="gap-4">
        <div className="flex items-center gap-2">
          <Archive size={20} className="text-default-500" />
          <h2 className="text-base font-semibold text-foreground">{t("settings.localBackup.title")}</h2>
        </div>

        <p className="text-sm text-default-600">
          {t("settings.localBackup.desc")}{" "}
          <code className="rounded bg-default-200 px-1 font-mono text-xs">SaveCloud/backups/[juego]/[fecha]</code>
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-default-600">
            {t("settings.localBackup.keepLast")}
            <Select
              selectedKeys={[String(keepLastN)]}
              onSelectionChange={async (keys) => {
                const value = Number(Array.from(keys)[0]) as (typeof KEEP_OPTIONS)[number];
                setKeepLastN(value);
                try {
                  await setKeepBackupsPerGame(value);
                  await refetch();
                } catch (e) {
                  toastError(t("settings.localBackup.toastSaveError"), e instanceof Error ? e.message : String(e));
                }
              }}
              className="min-w-22.5"
              size="sm">
              {KEEP_OPTIONS.map((n) => (
                <SelectItem key={String(n)} textValue={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </Select>
            {t("settings.localBackup.backupsPerGame")}
          </label>

          <Button
            size="sm"
            variant="flat"
            color="primary"
            onPress={handleCleanup}
            isLoading={cleaning}
            startContent={<Trash2 size={16} />}>
            {t("settings.localBackup.freeSpaceNow")}
          </Button>

          <Button size="sm" variant="flat" color="danger" onPress={() => setIsDeleteAllModalOpen(true)}>
            {t("settings.localBackup.deleteAll")}
          </Button>
        </div>

        <Modal
          isOpen={isDeleteAllModalOpen}
          onOpenChange={(open) => setIsDeleteAllModalOpen(open)}
          isDismissable={!cleaning}
          isKeyboardDismissDisabled={cleaning}>
          <ModalContent>
            <ModalHeader className="text-danger">{t("settings.localBackup.deleteAllTitle")}</ModalHeader>
            <ModalBody>
              <p className="text-sm text-default-700">
                <span className="font-medium">{t("settings.localBackup.deleteAllWarning")}</span>
              </p>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={() => setIsDeleteAllModalOpen(false)} isDisabled={cleaning}>
                {t("common.cancel")}
              </Button>
              <Button color="danger" isLoading={cleaning} onPress={handleDeleteAllBackups}>
                {t("settings.localBackup.confirmDelete")}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </CardBody>
    </Card>
  );
}
