import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
} from "@heroui/react";
import { open } from "@tauri-apps/plugin-dialog";
import { type as getOsType } from "@tauri-apps/plugin-os";
import { AppWindow, Cpu, FileSearch, RotateCcw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GameFormState } from "@/hooks/useGameForm";
import { listRunningProcessesForPick } from "@/services/tauri";

function launchTargetDialogFilters(t: (key: string) => string): { name: string; extensions: string[] }[] {
  const os = getOsType();
  if (os === "windows") {
    return [
      { name: t("library.gameDrawerLaunch.fileFilterWinExecutables"), extensions: ["exe", "jar", "bat", "cmd"] },
      { name: t("library.gameDrawerLaunch.fileFilterWinAll"), extensions: ["*"] },
    ];
  }
  if (os === "macos") {
    return [
      { name: t("library.gameDrawerLaunch.fileFilterMacApps"), extensions: ["app", "jar", "sh", "command"] },
      { name: t("library.gameDrawerLaunch.fileFilterMacAll"), extensions: ["*"] },
    ];
  }
  return [
    { name: t("library.gameDrawerLaunch.fileFilterLinuxExecutables"), extensions: ["jar", "sh", "AppImage", "run"] },
    { name: t("library.gameDrawerLaunch.fileFilterLinuxAll"), extensions: ["*"] },
  ];
}

interface GameDrawerLaunchTabProps {
  form: GameFormState;
  setField: <K extends keyof GameFormState>(key: K, value: GameFormState[K]) => void;
  setError: (error: string | null) => void;
  isOpen: boolean;
}

export function GameDrawerLaunchTab({ form, setField, setError, isOpen }: GameDrawerLaunchTabProps) {
  const { t } = useTranslation();
  const [processModalOpen, setProcessModalOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const {
    data: runningRows = [],
    isLoading: runningLoading,
    refetch: refetchProcesses,
  } = useQuery({
    queryKey: ["running-processes-for-pick"],
    queryFn: listRunningProcessesForPick,
    enabled: processModalOpen && isOpen,
    staleTime: 15_000,
  });

  const filteredRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return runningRows;
    return runningRows.filter((r) => r.name.toLowerCase().includes(q));
  }, [runningRows, filter]);

  const handlePickExecutable = useCallback(async () => {
    setError(null);
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: t("library.gameDrawerLaunch.pickLaunchTitle"),
        filters: launchTargetDialogFilters(t),
      });
      if (selected && typeof selected === "string") {
        setField("launchExecutablePath", selected);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [setError, setField, t]);

  const handleClearLaunch = useCallback(() => {
    setField("launchExecutablePath", "");
  }, [setField]);

  const handleOpenProcessModal = useCallback(() => {
    setFilter("");
    setProcessModalOpen(true);
    void refetchProcesses();
  }, [refetchProcesses]);

  const handleSelectProcess = useCallback(
    (name: string) => {
      setField("executableNames", [name]);
      setProcessModalOpen(false);
    },
    [setField]
  );

  const handleResetProcessDetection = useCallback(() => {
    setField("executableNames", []);
  }, [setField]);

  const manualNames = form.executableNames.length > 0 ? form.executableNames.join(", ") : null;
  const hasLaunchPath = Boolean(form.launchExecutablePath.trim());

  return (
    <>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-default-500">{t("library.gameDrawerLaunch.introSaveHint")}</p>

        <Card className="border border-default-200/60 shadow-sm">
          <CardBody className="space-y-3 px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm font-semibold text-default-700">
                {t("library.gameDrawerLaunch.launchFileTitle")}
              </span>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="bordered"
                  startContent={<FileSearch size={16} />}
                  onPress={handlePickExecutable}>
                  {t("library.gameDrawerLaunch.browseFile")}
                </Button>
                {hasLaunchPath && (
                  <Button
                    size="sm"
                    variant="light"
                    color="danger"
                    startContent={<Trash2 size={16} />}
                    onPress={handleClearLaunch}>
                    {t("library.gameDrawerLaunch.clearLaunch")}
                  </Button>
                )}
              </div>
            </div>
            {hasLaunchPath ? (
              <p className="break-all font-mono text-xs text-default-500" title={form.launchExecutablePath}>
                {form.launchExecutablePath}
              </p>
            ) : (
              <p className="text-xs text-default-400">{t("library.gameDrawerLaunch.noLaunchFileHint")}</p>
            )}
          </CardBody>
        </Card>

        <Card className="border border-default-200/60 shadow-sm">
          <CardBody className="space-y-3 px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-default-700">
                <Cpu size={16} />
                {t("library.gameDrawerLaunch.processDetectionTitle")}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="bordered" onPress={handleOpenProcessModal}>
                  {t("library.gameDrawerLaunch.pickRunningProcess")}
                </Button>
                {manualNames && (
                  <Button
                    size="sm"
                    variant="light"
                    startContent={<RotateCcw size={16} />}
                    onPress={handleResetProcessDetection}>
                    {t("library.gameDrawerLaunch.automatic")}
                  </Button>
                )}
              </div>
            </div>
            <p className="text-xs text-default-500">{t("library.gameDrawerLaunch.processDetectionDesc")}</p>
            {manualNames ? (
              <div className="flex flex-wrap gap-2">
                {form.executableNames.map((n) => (
                  <Chip key={n} size="sm" variant="flat" color="primary">
                    {n}
                  </Chip>
                ))}
              </div>
            ) : (
              <p className="text-xs italic text-default-400">{t("library.gameDrawerLaunch.autoInference")}</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Modal
        isOpen={processModalOpen}
        onOpenChange={(open) => {
          if (!open) setProcessModalOpen(false);
        }}
        size="2xl"
        scrollBehavior="inside"
        placement="center">
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span>{t("library.gameDrawerLaunch.processModalTitle")}</span>
            <span className="text-xs font-normal text-default-500">
              {t("library.gameDrawerLaunch.processModalSubtitle")}
            </span>
          </ModalHeader>
          <ModalBody className="gap-3">
            <Input
              label={t("library.gameDrawerLaunch.filterLabel")}
              placeholder={t("library.gameDrawerLaunch.filterPlaceholder")}
              value={filter}
              onValueChange={setFilter}
              size="sm"
            />
            <div className="max-h-72 overflow-y-auto rounded-medium border border-default-200 p-2">
              {runningLoading ? (
                <div className="flex justify-center py-8">
                  <Spinner size="sm" />
                </div>
              ) : filteredRows.length === 0 ? (
                <p className="py-6 text-center text-sm text-default-400">
                  {runningRows.length === 0
                    ? t("library.gameDrawerLaunch.noProcesses")
                    : t("library.gameDrawerLaunch.noFilterResults")}
                </p>
              ) : (
                <ul className="space-y-1">
                  {filteredRows.map((row) => (
                    <li key={row.name}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-medium px-3 py-2 text-left text-sm transition-colors hover:bg-default-100"
                        onClick={() => handleSelectProcess(row.name)}>
                        {row.iconPngBase64 ? (
                          <img
                            src={`data:image/png;base64,${row.iconPngBase64}`}
                            alt=""
                            className="h-7 w-7 shrink-0 rounded-medium object-contain"
                            draggable={false}
                            loading="lazy"
                          />
                        ) : (
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-medium bg-default-100">
                            <AppWindow className="h-4 w-4 text-default-400" aria-hidden />
                          </span>
                        )}
                        <span className="min-w-0 truncate">{row.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setProcessModalOpen(false)}>
              {t("common.close")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
