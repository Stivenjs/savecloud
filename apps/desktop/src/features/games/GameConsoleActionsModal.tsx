import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import {
  Archive,
  CloudDownload,
  CloudUpload,
  ExternalLink,
  FolderOpen,
  Gamepad2,
  Link2,
  Magnet,
  Pencil,
  Trash2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useNavigationStore } from "@features/input/store";
import { useNavigable } from "@features/input/useNavigable";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";
import { formatGameDisplayName } from "@utils/gameImage";
import type { GameActionsMenuModelProps } from "@features/games/game-actions/gameActionMenuModel";
import {
  getFolderMenuLabel,
  getGameActionsDisabledKeys,
  isGameActionItemHidden,
  runGameAction,
} from "@features/games/game-actions/gameActionMenuModel";
import { getKenneyGamepadAssetUrl, kenneyFaceAssetId } from "@/lib/kenneyGamepadAssets";
import type { GamepadLayoutKind } from "@/lib/gamepadLabelMaps";

const CONSOLE_ACTIONS_LAYER = "game-console-actions";

interface ActionItemDef {
  key: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  isDestructive?: boolean;
}

function ConsoleActionRow({
  actionKey,
  label,
  description,
  icon,
  isDestructive,
  disabled,
  onTrigger,
}: {
  actionKey: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  isDestructive?: boolean;
  disabled?: boolean;
  onTrigger: () => void;
}) {
  const navId = `console-action-${actionKey}`;
  const { isFocused, inputMode, navProps } = useNavigable({
    id: navId,
    layerId: CONSOLE_ACTIONS_LAYER,
    onPress: disabled ? undefined : onTrigger,
  });
  const isGamepadFocused = isFocused && inputMode === "gamepad";

  return (
    <button
      type="button"
      {...navProps}
      disabled={disabled}
      onClick={disabled ? undefined : onTrigger}
      className={[
        "w-full text-left p-3.5 rounded-xl border transition-all flex items-center gap-3.5 relative outline-none select-none",
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
        isGamepadFocused || isFocused
          ? isDestructive
            ? "border-danger bg-danger/15 text-danger shadow-md shadow-danger/20 ring-2 ring-danger scale-[1.01]"
            : "border-primary bg-primary/15 text-foreground shadow-md shadow-primary/20 ring-2 ring-primary scale-[1.01]"
          : isDestructive
            ? "border-danger/30 bg-danger/5 hover:bg-danger/10 text-danger"
            : "border-divider bg-content2/40 hover:bg-content2/70 text-foreground",
      ].join(" ")}>
      <div
        className={[
          "size-10 rounded-xl flex items-center justify-center shrink-0 transition-colors",
          isGamepadFocused || isFocused
            ? isDestructive
              ? "bg-danger text-danger-foreground"
              : "bg-primary text-primary-foreground"
            : isDestructive
              ? "bg-danger/20 text-danger"
              : "bg-default-100 dark:bg-default-50/15 text-default-500",
        ].join(" ")}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={`text-[15px] font-semibold leading-tight truncate ${isDestructive ? "text-danger" : "text-foreground"}`}>
          {label}
        </p>
        {description && <p className="text-xs text-default-400 truncate mt-1">{description}</p>}
      </div>
    </button>
  );
}

export interface GameConsoleActionsModalProps extends GameActionsMenuModelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GameConsoleActionsModal(props: GameConsoleActionsModalProps) {
  const { isOpen, onClose, game } = props;
  const { t } = useTranslation();
  const pushLayer = useNavigationStore((s) => s.pushLayer);
  const popLayer = useNavigationStore((s) => s.popLayer);

  const disabledKeys = useMemo(() => getGameActionsDisabledKeys(props), [props]);
  const folderLabel = getFolderMenuLabel(props.surface);

  const { data: preferredLayout } = useQuery({
    queryKey: ["preferred-gamepad-layout"],
    queryFn: () => (isTauri() ? invoke<string | null>("get_preferred_gamepad_layout") : Promise.resolve(null)),
    staleTime: 5 * 60 * 1000,
  });

  const layoutKind: GamepadLayoutKind = useMemo(() => {
    if (
      preferredLayout === "playstation" ||
      preferredLayout === "nintendo" ||
      preferredLayout === "xbox" ||
      preferredLayout === "generic"
    ) {
      return preferredLayout;
    }
    return "xbox";
  }, [preferredLayout]);

  const selectUrl = useMemo(
    () => getKenneyGamepadAssetUrl(layoutKind, kenneyFaceAssetId(layoutKind, "South")),
    [layoutKind]
  );
  const backUrl = useMemo(
    () => getKenneyGamepadAssetUrl(layoutKind, kenneyFaceAssetId(layoutKind, "East")),
    [layoutKind]
  );

  const actionItems: ActionItemDef[] = useMemo(() => {
    const items: ActionItemDef[] = [];

    if (!isGameActionItemHidden("sync", props)) {
      items.push({
        key: "sync",
        label: t("library.actionsMenu.uploadToCloud"),
        description: t("library.syncBadge.pendingUploadTooltip", {
          defaultValue: "Sincronizar guardados con la nube",
        }),
        icon: props.isSyncing ? (
          <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <CloudUpload size={20} />
        ),
      });
    }

    if (!isGameActionItemHidden("recoverFromCloud", props)) {
      items.push({
        key: "recoverFromCloud",
        label: t("library.actionsMenu.recoverSaves"),
        description: t("library.actionsMenu.recoverSavesDesc", {
          defaultValue: "Traer copias y guardados de la nube",
        }),
        icon: props.isDownloading ? (
          <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <CloudDownload size={20} />
        ),
      });
    }

    if (!isGameActionItemHidden("fullBackup", props)) {
      items.push({
        key: "fullBackup",
        label: props.isUploadTooLarge
          ? t("library.actionsMenu.packageUploadRequired")
          : t("library.actionsMenu.packageUpload"),
        description: t("library.actionsMenu.fullBackupDesc", {
          defaultValue: "Crear y subir backup completo empaquetado",
        }),
        icon: props.isFullBackupUploading ? (
          <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <Archive size={20} />
        ),
      });
    }

    if (!isGameActionItemHidden("folder", props)) {
      items.push({
        key: "folder",
        label: folderLabel,
        description: t("library.actionsMenu.folderDesc", { defaultValue: "Abrir carpeta en el explorador" }),
        icon: <FolderOpen size={20} />,
      });
    }

    if (!isGameActionItemHidden("edit", props)) {
      items.push({
        key: "edit",
        label: t("library.actionsMenu.edit"),
        description: t("library.actionsMenu.editDesc", { defaultValue: "Modificar rutas y configuración" }),
        icon: <Pencil size={20} />,
      });
    }

    if (!isGameActionItemHidden("torrent", props)) {
      items.push({
        key: "torrent",
        label: t("library.actionsMenu.torrent"),
        description: t("library.actionsMenu.torrentDesc", { defaultValue: "Gestionar torrents y descarga P2P" }),
        icon: <Magnet size={20} />,
      });
    }

    if (game.sourceUrl) {
      items.push({
        key: "source",
        label: t("library.actionsMenu.openSourceUrl"),
        description: t("library.actionsMenu.openSourceUrlDesc", { defaultValue: "Abrir web oficial del juego" }),
        icon: <ExternalLink size={20} />,
      });
    }

    if (!isGameActionItemHidden("share", props)) {
      items.push({
        key: "share",
        label: t("library.actionsMenu.shareLink"),
        description: t("library.actionsMenu.shareLinkDesc", { defaultValue: "Generar y copiar enlace de descarga" }),
        icon: <Link2 size={20} />,
      });
    }

    if (!isGameActionItemHidden("remove", props)) {
      items.push({
        key: "remove",
        label: t("library.actionsMenu.remove"),
        description: t("library.actionsMenu.removeDesc", { defaultValue: "Eliminar de la biblioteca o nube" }),
        icon: <Trash2 size={20} />,
        isDestructive: true,
      });
    }

    return items;
  }, [props, t, folderLabel, game.sourceUrl]);

  // Manejo de la capa de navegación cuando se abre o cierra el modal
  useEffect(() => {
    if (!isOpen) return;
    const firstEnabledItem = actionItems.find((it) => !disabledKeys.includes(it.key)) || actionItems[0];
    const initialFocus = firstEnabledItem ? `console-action-${firstEnabledItem.key}` : undefined;
    pushLayer(CONSOLE_ACTIONS_LAYER, initialFocus);
    return () => {
      popLayer();
    };
  }, [isOpen]);

  useRegisterGlobalBack(() => {
    if (isOpen) {
      onClose();
      return true;
    }
    return false;
  });

  const handleSelectAction = async (key: string) => {
    onClose();
    await runGameAction(key, game, props);
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      placement="center"
      size="lg"
      backdrop="blur"
      hideCloseButton
      autoFocus={false}
      classNames={{
        header: "border-b border-divider pb-3 px-6 pt-5",
        body: "py-4 px-6 gap-2.5 max-h-[65vh] overflow-y-auto",
        footer: "border-t border-divider py-3.5 px-6",
      }}>
      <ModalContent>
        <ModalHeader className="flex items-center gap-3.5">
          <div className="p-3 rounded-xl bg-primary/10 text-primary shrink-0">
            <Gamepad2 size={24} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              {t("library.actionsMenu.title", { defaultValue: "Acciones del juego" })}
            </span>
            <h2 className="text-xl font-bold text-foreground truncate mt-0.5">{formatGameDisplayName(game.id)}</h2>
          </div>
        </ModalHeader>
        <ModalBody>
          <div className="flex flex-col gap-2">
            {actionItems.map((item) => (
              <ConsoleActionRow
                key={item.key}
                actionKey={item.key}
                label={item.label}
                description={item.description}
                icon={item.icon}
                isDestructive={item.isDestructive}
                disabled={disabledKeys.includes(item.key)}
                onTrigger={() => handleSelectAction(item.key)}
              />
            ))}
          </div>
        </ModalBody>
        <ModalFooter className="flex items-center justify-start">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2.5">
              {selectUrl ? (
                <img src={selectUrl} alt="A" className="size-6 object-contain pointer-events-none drop-shadow-sm" />
              ) : (
                <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                  A
                </span>
              )}
              <span className="text-sm font-medium text-default-400">
                {t("bigPictureUi.hints.select", { defaultValue: "Seleccionar" })}
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              {backUrl ? (
                <img src={backUrl} alt="B" className="size-6 object-contain pointer-events-none drop-shadow-sm" />
              ) : (
                <span className="inline-flex size-6 items-center justify-center rounded-full bg-default-100 text-xs font-bold text-default-400">
                  B
                </span>
              )}
              <span className="text-sm font-medium text-default-400">
                {t("bigPictureUi.hints.back", { defaultValue: "Atrás" })}
              </span>
            </div>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
