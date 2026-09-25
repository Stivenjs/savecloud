import { useMemo } from "react";
import { Avatar, Button, Divider } from "@heroui/react";
import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ProfileAvatarVisual } from "@features/profile/ProfileAvatarVisual";
import { toastSuccess } from "@utils/toast";
import type { ConnectionStatus } from "@hooks/useLastSyncInfo";
import { ConnectionStatusIndicator } from "@features/games/ConnectionStatusIndicator";
import { resolveProfileAsset } from "@utils/profileMedia";

export interface UserBadgeProps {
  userId?: string | null;
  /** Avatar del perfil (URL, data URL o ruta local guardada en config). */
  profileAvatar?: string | null;
  /** Marco opcional (misma lógica que en el drawer, en miniatura). */
  profileFrame?: string | null;
  hasSyncConfig?: boolean;
  connectionStatus?: ConnectionStatus;
  /** Abre el drawer de perfil (apariencia y estadísticas). */
  onOpenProfile?: () => void;
  /** Precarga el módulo del drawer (p. ej. al pasar el ratón) para abrir más rápido. */
  onIntentOpenProfile?: () => void;
}

export function UserBadge({
  userId,
  profileAvatar,
  profileFrame,
  hasSyncConfig,
  connectionStatus,
  onOpenProfile,
  onIntentOpenProfile,
}: UserBadgeProps) {
  const { t } = useTranslation();
  const isConfigured = !!userId?.trim();

  const frameSrc = useMemo(() => resolveProfileAsset(profileFrame ?? undefined), [profileFrame]);

  const handleCopy = async () => {
    if (!isConfigured) return;
    try {
      await navigator.clipboard.writeText(userId ?? "");
      toastSuccess(t("library.userBadge.copiedTitle"), t("library.userBadge.copiedDesc"));
    } catch {
      // ignore
    }
  };

  const userBlock = (
    <div className="flex min-w-0 items-center gap-2">
      <div className="relative size-8 shrink-0">
        <div className="relative size-full overflow-hidden rounded-md border border-default-200/70 bg-default-100/60 dark:border-default-100/35 dark:bg-default-50/25">
          {profileAvatar ? (
            <ProfileAvatarVisual rawAvatar={profileAvatar} alt="avatar" className="size-full object-cover" />
          ) : (
            <Avatar
              size="sm"
              radius="none"
              showFallback
              classNames={{
                base: `size-full min-h-8 min-w-8 rounded-md bg-primary/10 text-primary`,
                img: "object-cover",
              }}
            />
          )}
        </div>
        {frameSrc ? (
          <img
            src={frameSrc}
            alt=""
            className="pointer-events-none absolute inset-0 z-10 size-full object-contain opacity-[0.92]"
          />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col justify-center">
        {isConfigured ? (
          <span className="truncate text-sm font-semibold tracking-tight text-foreground/90">{userId}</span>
        ) : (
          <span className="text-xs font-medium text-default-400">{t("library.userBadge.notConfigured")}</span>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex items-center gap-1.5 text-foreground pl-1.5">
      {onOpenProfile ? (
        <Button
          variant="light"
          radius="full"
          className="h-9 min-h-0 min-w-0 px-2.5 hover:bg-default-100/50"
          onPointerEnter={() => onIntentOpenProfile?.()}
          onFocus={() => onIntentOpenProfile?.()}
          onPress={onOpenProfile}>
          {userBlock}
        </Button>
      ) : (
        <div className="px-2.5 py-1">{userBlock}</div>
      )}

      {isConfigured && (
        <Button
          size="sm"
          variant="light"
          radius="full"
          isIconOnly
          aria-label={t("library.userBadge.copyUser")}
          onPress={handleCopy}
          className="h-7 w-7 min-w-0 text-default-400 hover:text-foreground hover:bg-default-100/50">
          <Copy size={13} />
        </Button>
      )}

      {hasSyncConfig && connectionStatus && (
        <>
          <Divider orientation="vertical" className="mx-0.5 h-4 bg-default-200/50" />
          <div className="pl-1 pr-1.5">
            <ConnectionStatusIndicator status={connectionStatus} />
          </div>
        </>
      )}
    </div>
  );
}
