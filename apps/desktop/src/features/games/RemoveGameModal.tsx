import { useState } from "react";
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Checkbox, Chip } from "@heroui/react";
import { Trash2, CloudOff, AlertTriangle, Archive, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ConfiguredGame } from "@app-types/config";
import { formatGameDisplayName } from "@/utils/gameImage";

interface RemoveGameModalProps {
  isOpen: boolean;
  onClose: () => void;
  game: ConfiguredGame | null;
  onConfirm: (gameId: string, permanent?: boolean) => Promise<void>;
  onClearCloudOnly?: (gameId: string, permanent?: boolean) => Promise<void>;
  hasCloudIntegration?: boolean;
}

type RemoveTargetAction = "cloud_only" | "full";

export function RemoveGameModal({
  isOpen,
  onClose,
  game,
  onConfirm,
  onClearCloudOnly,
  hasCloudIntegration = true,
}: RemoveGameModalProps) {
  const { t } = useTranslation();
  const [targetAction, setTargetAction] = useState<RemoveTargetAction>("cloud_only");
  const [isPermanent, setIsPermanent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setIsPermanent(false);
      setTargetAction("cloud_only");
      onClose();
    }
  };

  if (!game) return null;

  const gameTitle = formatGameDisplayName(game.id);
  const pathsInfo = game.paths.length > 1 ? t("library.removeModal.pathsInfo_other", { count: game.paths.length }) : "";

  const handleExecuteAction = async () => {
    setLoading(true);
    try {
      if (targetAction === "cloud_only" && onClearCloudOnly) {
        await onClearCloudOnly(game.id, isPermanent);
      } else {
        await onConfirm(game.id, isPermanent);
      }
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={handleOpenChange} placement="center" size="lg">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2.5 pb-2">
          <div className="p-2 rounded-lg bg-warning/10 text-warning">
            <Trash2 size={20} />
          </div>
          <div className="flex flex-col">
            <span className="text-base font-bold text-foreground">{t("library.removeModal.title")}</span>
            <span className="text-xs font-normal text-default-400">{gameTitle}</span>
          </div>
        </ModalHeader>

        <ModalBody className="space-y-4 py-2">
          <p className="text-sm text-default-600">
            {t("library.removeModal.confirm", { gameId: gameTitle, pathsInfo })}
          </p>

          {/* Opciones de destino como tarjetas interactivas */}
          <div className="flex flex-col gap-2.5">
            {hasCloudIntegration && onClearCloudOnly && (
              <button
                type="button"
                onClick={() => setTargetAction("cloud_only")}
                className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-start gap-3 relative ${
                  targetAction === "cloud_only"
                    ? "border-warning/80 bg-warning/5 dark:bg-warning/10 shadow-sm"
                    : "border-default-200/70 dark:border-default-100/10 hover:bg-default-50/50 dark:hover:bg-default-100/5 opacity-80 hover:opacity-100"
                }`}>
                <div
                  className={`p-2 rounded-lg mt-0.5 shrink-0 ${
                    targetAction === "cloud_only"
                      ? "bg-warning text-warning-foreground"
                      : "bg-default-100 text-default-500"
                  }`}>
                  <CloudOff size={18} />
                </div>
                <div className="flex-1 min-w-0 pr-6">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{t("library.removeModal.deleteCloudOnly")}</p>
                    <Chip size="sm" variant="flat" color="warning" className="text-[10px] h-5">
                      {t("library.removeModal.recommendedBadge", "Recomendado")}
                    </Chip>
                  </div>
                  <p className="text-xs text-default-500 mt-1 leading-relaxed">
                    {t("library.removeModal.deleteCloudOnlyDesc")}
                  </p>
                </div>
                {targetAction === "cloud_only" && (
                  <CheckCircle2 size={18} className="text-warning absolute top-3.5 right-3.5 shrink-0" />
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => setTargetAction("full")}
              className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-start gap-3 relative ${
                targetAction === "full"
                  ? "border-danger/80 bg-danger/5 dark:bg-danger/10 shadow-sm"
                  : "border-default-200/70 dark:border-default-100/10 hover:bg-default-50/50 dark:hover:bg-default-100/5 opacity-80 hover:opacity-100"
              }`}>
              <div
                className={`p-2 rounded-lg mt-0.5 shrink-0 ${
                  targetAction === "full" ? "bg-danger text-danger-foreground" : "bg-default-100 text-default-500"
                }`}>
                <Trash2 size={18} />
              </div>
              <div className="flex-1 min-w-0 pr-6">
                <p className="text-sm font-semibold text-foreground">{t("library.removeModal.deleteGameCompletely")}</p>
                <p className="text-xs text-default-500 mt-1 leading-relaxed">
                  {t("library.removeModal.deleteGameCompletelyDesc")}
                </p>
              </div>
              {targetAction === "full" && (
                <CheckCircle2 size={18} className="text-danger absolute top-3.5 right-3.5 shrink-0" />
              )}
            </button>
          </div>

          {/* Selector de Papelera vs Purga Inmediata */}
          <div className="pt-2 border-t border-default-200/50 dark:border-default-100/10">
            <Checkbox size="sm" color="danger" isSelected={isPermanent} onValueChange={setIsPermanent}>
              <span className="text-xs text-default-700 font-medium">{t("library.removeModal.permanentCheckbox")}</span>
            </Checkbox>
            <div className="flex items-center gap-1.5 pl-6 mt-1">
              {!isPermanent ? (
                <>
                  <Archive size={13} className="text-success shrink-0" />
                  <p className="text-[11px] text-default-400">{t("library.removeModal.trashHint")}</p>
                </>
              ) : (
                <>
                  <AlertTriangle size={13} className="text-danger shrink-0" />
                  <p className="text-[11px] text-danger">{t("library.removeModal.permanentWarning")}</p>
                </>
              )}
            </div>
          </div>
        </ModalBody>

        <ModalFooter className="flex items-center justify-end gap-2.5 border-t border-default-200/50 dark:border-default-100/10 pt-3">
          <Button variant="flat" size="sm" onPress={onClose} isDisabled={loading}>
            {t("common.cancel")}
          </Button>

          <Button
            color={targetAction === "full" ? "danger" : isPermanent ? "danger" : "warning"}
            size="sm"
            onPress={handleExecuteAction}
            isLoading={loading}
            startContent={targetAction === "full" ? <Trash2 size={16} /> : <CloudOff size={16} />}>
            {targetAction === "cloud_only"
              ? isPermanent
                ? t("library.removeModal.purgeCloudConfirm", "Purgar guardados de la nube")
                : t("library.removeModal.deleteCloudOnly")
              : isPermanent
                ? t("library.removeModal.purgeFullConfirm", "Eliminar permanentemente")
                : t("library.removeModal.deleteGameCompletely")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
