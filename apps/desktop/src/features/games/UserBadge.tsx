import { useMemo } from "react";
import { Avatar, Button, Divider } from "@heroui/react";
import { Copy } from "lucide-react";
import { ProfileAvatarVisual } from "@features/profile/ProfileAvatarVisual";
import { toastSuccess } from "@utils/toast";
import type { ConnectionStatus } from "@hooks/useLastSyncInfo";
import { ConnectionStatusIndicator } from "@features/games/ConnectionStatusIndicator";
import { resolveProfileAsset } from "@utils/profileMedia";
import { parseLegacyNiceAvatarHtml, parseNiceAvatarConfig } from "@features/profile/niceAvatar";

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
  const isConfigured = !!userId?.trim();

  const avatarSrc = useMemo(() => resolveProfileAsset(profileAvatar ?? undefined), [profileAvatar]);
  const hasGeneratedAvatar = useMemo(
    () => !!parseNiceAvatarConfig(profileAvatar) || !!parseLegacyNiceAvatarHtml(profileAvatar),
    [profileAvatar]
  );
  const frameSrc = useMemo(() => resolveProfileAsset(profileFrame ?? undefined), [profileFrame]);

  const handleCopy = async () => {
    if (!isConfigured) return;
    try {
      await navigator.clipboard.writeText(userId ?? "");
      toastSuccess("Usuario copiado", "Puedes compartirlo con tus amigos.");
    } catch {
      // ignore
    }
  };

  const userBlock = (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div className="relative size-8 shrink-0">
        <div className="relative size-full overflow-hidden rounded-md border border-default-200/70 bg-default-100/60 dark:border-default-100/35 dark:bg-default-50/25">
          {hasGeneratedAvatar ? (
            <ProfileAvatarVisual rawAvatar={profileAvatar} alt="avatar" className="size-full object-cover" />
          ) : (
            <Avatar
              size="sm"
              radius="none"
              showFallback
              src={avatarSrc ?? undefined}
              classNames={{
                base: `size-full min-h-8 min-w-8 rounded-md ${avatarSrc ? "" : "bg-primary/10 text-primary"}`,
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
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs font-medium text-foreground">Tu ID de Sincronización</span>
        {isConfigured ? (
          <code className="block truncate font-mono text-xs text-default-500">{userId}</code>
        ) : (
          <span className="text-xs text-default-400">Sin configurar</span>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex w-fit items-center gap-2 px-3 py-1.5 text-foreground">
      {onOpenProfile ? (
        <Button
          variant="light"
          className="h-auto min-h-0 flex-1 justify-start gap-0 px-1 py-0"
          onPointerEnter={() => onIntentOpenProfile?.()}
          onFocus={() => onIntentOpenProfile?.()}
          onPress={onOpenProfile}>
          {userBlock}
        </Button>
      ) : (
        userBlock
      )}

      {isConfigured && (
        <Button
          size="sm"
          variant="light"
          isIconOnly
          aria-label="Copiar usuario"
          onPress={handleCopy}
          className="-ml-1 text-default-400 hover:text-foreground">
          <Copy size={16} />
        </Button>
      )}

      {hasSyncConfig && connectionStatus && (
        <>
          <Divider orientation="vertical" className="mx-1 h-6" />
          <div className="px-1">
            <ConnectionStatusIndicator status={connectionStatus} />
          </div>
        </>
      )}
    </div>
  );
}
