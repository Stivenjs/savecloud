import { memo, useMemo } from "react";
import { User } from "lucide-react";
import { formatPlaytime } from "@utils/format";
import { isProfileVideoSource, resolveProfileAsset } from "@utils/profileMedia";

export const ProfileHeroBackground = memo(function ProfileHeroBackground({
  rawUrl,
  imageMode = "contain",
}: {
  rawUrl: string;
  imageMode?: "cover" | "contain";
}) {
  const resolved = useMemo(() => resolveProfileAsset(rawUrl), [rawUrl]);
  const isVideo = isProfileVideoSource(rawUrl);

  if (!resolved) return null;

  if (isVideo) {
    return (
      <>
        {imageMode === "contain" && (
          <video
            src={resolved}
            className="absolute inset-0 size-full object-cover opacity-40 blur-2xl scale-110"
            autoPlay
            muted
            loop
            playsInline
            preload="none"
          />
        )}
        <video
          src={resolved}
          className={`absolute inset-0 size-full object-${imageMode} drop-shadow-2xl`}
          autoPlay
          muted
          loop
          playsInline
          preload="none"
        />
      </>
    );
  }
  return (
    <>
      {imageMode === "contain" && (
        <img
          src={resolved}
          alt=""
          decoding="async"
          className="absolute inset-0 size-full object-cover opacity-40 blur-2xl scale-110"
        />
      )}
      <img
        src={resolved}
        alt=""
        decoding="async"
        className={`absolute inset-0 size-full object-${imageMode} drop-shadow-2xl`}
      />
    </>
  );
});

export interface PublicProfileHeroProps {
  displayName: string;
  profileBackground?: string;
  profileAvatar?: string;
  profileFrame?: string;
  totalPlaytimeSeconds: number;
  gamesCount: number;
}

export function PublicProfileHero({
  displayName,
  profileBackground,
  profileAvatar,
  profileFrame,
  totalPlaytimeSeconds,
  gamesCount,
}: PublicProfileHeroProps) {
  const bg = profileBackground?.trim() ?? "";
  const avatarResolved = useMemo(() => resolveProfileAsset(profileAvatar || undefined), [profileAvatar]);
  const frameResolved = useMemo(() => resolveProfileAsset(profileFrame || undefined), [profileFrame]);

  const fallbackLevel = useMemo(
    () => Math.min(99, Math.max(1, Math.floor(Math.sqrt(Math.max(1, totalPlaytimeSeconds / 3600))) + 1)),
    [totalPlaytimeSeconds]
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-primary-200/50 bg-content1 shadow-sm dark:border-primary-500/25">
      <div
        className={`relative w-full overflow-hidden ${
          bg ? "min-h-[min(48vh,22rem)] max-h-[min(58vh,28rem)]" : "min-h-[min(36vh,14rem)] max-h-[min(44vh,18rem)]"
        }`}>
        {bg ? (
          <ProfileHeroBackground rawUrl={bg} />
        ) : (
          <div className="absolute inset-0 bg-[linear-gradient(125deg,#1b2838_0%,#0e1621_45%,#1b2838_100%)]" />
        )}
        <div className="absolute inset-0 bg-linear-to-t from-content1 via-content1/45 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 flex items-end gap-4 px-4 pb-3">
          <div className="relative size-18 shrink-0">
            <div className="relative size-full overflow-hidden rounded-md border border-white/10 bg-black/30 shadow-lg">
              {avatarResolved ? (
                <img src={avatarResolved} alt="" decoding="async" className="size-full object-cover" />
              ) : (
                <div className="flex size-full items-center justify-center text-default-400">
                  <User size={36} strokeWidth={1.2} />
                </div>
              )}
            </div>
            {frameResolved ? (
              <img
                src={frameResolved}
                alt="user frame"
                decoding="async"
                className="pointer-events-none absolute inset-0 size-full object-contain"
              />
            ) : null}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <h2 className="truncate text-lg font-semibold text-foreground">{displayName}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-default-500">{formatPlaytime(totalPlaytimeSeconds)} jugados</span>
              <span className="text-default-400">·</span>
              <span className="text-default-500">
                {gamesCount} {gamesCount === 1 ? "juego" : "juegos"}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 pb-0.5">
            <div className="flex items-center gap-1.5 rounded-full border border-default-200/80 bg-default-100/80 px-2.5 py-0.5 text-xs dark:bg-default-50/10">
              <span className="text-default-500">Nivel</span>
              <span className="flex size-6 items-center justify-center rounded-full border border-primary/40 bg-primary/10 font-semibold text-primary">
                {fallbackLevel}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
