import { useEffect, useMemo, useState } from "react";
import { Avatar } from "@heroui/react";
import { ProfileAvatarVisual } from "@features/profile/ProfileAvatarVisual";
import { resolveProfileAsset } from "@utils/profileMedia";

export interface BigPictureHeaderHudProps {
  profileAvatar?: string | null;
  profileFrame?: string | null;
  onOpenProfile: () => void;
  onIntentOpenProfile?: () => void;
}

function formatLocalTime(now: Date) {
  return now.toLocaleTimeString("es-CO", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Barra superior mínima para Big Picture: hora local y avatar (abre el perfil).
 */
export function BigPictureHeaderHud({
  profileAvatar,
  profileFrame,
  onOpenProfile,
  onIntentOpenProfile,
}: BigPictureHeaderHudProps) {
  const [now, setNow] = useState(() => new Date());
  const frameSrc = useMemo(() => resolveProfileAsset(profileFrame ?? undefined), [profileFrame]);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = window.setInterval(tick, 30_000);
    tick();
    return () => clearInterval(id);
  }, []);

  const timeLabel = formatLocalTime(now);

  return (
    <div className="sm-bp-header-hud flex items-center gap-5">
      <time
        dateTime={now.toISOString()}
        className="select-none whitespace-nowrap text-lg font-semibold tabular-nums tracking-tight text-foreground md:text-xl">
        {timeLabel}
      </time>

      <button
        type="button"
        className="group sm-bp-header-hud-profile tap-highlight-transparent relative shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0 outline-none transition-transform duration-150 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label="Abrir perfil"
        onPointerEnter={() => onIntentOpenProfile?.()}
        onFocus={() => onIntentOpenProfile?.()}
        onClick={onOpenProfile}>
        <span className="relative flex size-11 overflow-visible md:size-12">
          <span className="absolute -inset-[2px] rounded-md bg-zinc-950 dark:bg-black" aria-hidden />
          <span className="relative flex size-full overflow-hidden rounded-[5px] border border-black/80 bg-default-100/60 ring-2 ring-black/90 dark:bg-default-50/20 dark:ring-black">
            {profileAvatar ? (
              <ProfileAvatarVisual rawAvatar={profileAvatar} alt="Tu perfil" className="size-full object-cover" />
            ) : (
              <Avatar
                size="sm"
                radius="none"
                showFallback
                classNames={{
                  base: "size-full min-h-11 min-w-11 rounded-none bg-primary/15 text-primary md:min-h-12 md:min-w-12",
                  img: "object-cover",
                }}
              />
            )}
          </span>
          {frameSrc ? (
            <img
              src={frameSrc}
              alt=""
              className="pointer-events-none absolute inset-0 z-10 size-full object-contain opacity-[0.92]"
            />
          ) : null}
          <span
            className="pointer-events-none absolute right-0 top-[14%] z-20 h-[72%] w-[3px] rounded-full bg-primary"
            aria-hidden
          />
        </span>
      </button>
    </div>
  );
}
