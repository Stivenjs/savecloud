import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Accordion,
  AccordionItem,
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  Input,
  Switch,
} from "@heroui/react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowUpCircle,
  CircleHelp,
  Clock,
  CloudUpload,
  Flame,
  FolderOpen,
  Gamepad2,
  ImageIcon,
  Layers,
  Link2,
  MonitorPlay,
  RefreshCw,
  Save,
  Shield,
  Star,
  Trophy,
  User,
  Zap,
  LogOut,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useProfileSessionStore } from "@store/ProfileSessionStore";
import { ProfileAvatarVisual } from "@features/profile/ProfileAvatarVisual";
import { ProfileHeroBackground } from "@features/profile/PublicProfileHero";
import { buildNiceAvatarConfig, generateNiceAvatarSeed, serializeNiceAvatarConfig } from "@features/profile/niceAvatar";
import { PresenceStatusChip } from "@features/friends/PresenceStatusChip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Config } from "@app-types/config";
import type { GamificationState } from "@app-types/gamification";
import type { ConnectionStatus } from "@hooks/useLastSyncInfo";
import { useCloudPresenceRealtimeInvalidation } from "@hooks/useCloudPresenceRealtimeInvalidation";
import { CONFIG_QUERY_KEY } from "@hooks/useConfig";
import { useProfileSession } from "@hooks/useProfileSession";
import {
  readImageAsDataUrl,
  scheduleConfigBackupToCloud,
  setProfileAppearance,
  setShareVisualProfileWithHosts,
  setShareVisualProfileWithMembers,
} from "@services/tauri";
import { listCloudPresence } from "@services/tauri/invites.service";
import { achievementLabel, formatHoursToNextLevel } from "@utils/gamificationLabels";
import { formatPlaytime } from "@utils/format";
import { resolveProfileAsset } from "@utils/profileMedia";
import { toastError, toastSuccess } from "@utils/toast";

interface ProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  config: Config | null;
  gamification?: GamificationState | null;
  hasSyncConfig?: boolean;
  connectionStatus?: ConnectionStatus;
  bigPictureConsole?: boolean;
  bpReserveGlobalTopChromeSlot?: boolean;
}

function connectionLabel(status: ConnectionStatus | undefined): { text: string; tone: string } {
  switch (status) {
    case "connected":
      return { text: "En línea", tone: "text-success" };
    case "connecting":
      return { text: "Conectando…", tone: "text-default-500" };
    case "retrying":
      return { text: "Reintentando…", tone: "text-warning" };
    case "error":
      return { text: "Sin conexión", tone: "text-danger" };
    default:
      return { text: "—", tone: "text-default-400" };
  }
}

function AchievementIcon({ id, size = 14 }: { id: string; size?: number }) {
  if (id === "first_upload") return <CloudUpload size={size} className="text-primary" />;
  if (id.startsWith("syncs_")) return <RefreshCw size={size} className="text-success" />;
  if (id.startsWith("level_")) return <ArrowUpCircle size={size} className="text-warning" />;
  if (id.startsWith("streak_")) return <Flame size={size} className="text-danger" />;
  return <Star size={size} className="text-default-400" />;
}

export function ProfileDrawer({
  isOpen,
  onClose,
  config,
  gamification,
  hasSyncConfig,
  connectionStatus,
  bigPictureConsole = false,
  bpReserveGlobalTopChromeSlot = true,
}: ProfileDrawerProps) {
  const bp = bigPictureConsole;
  const { activeProfile } = useProfileSession();
  const queryClient = useQueryClient();
  const [bg, setBg] = useState("");
  const [avatar, setAvatar] = useState("");
  const [frame, setFrame] = useState("");
  const [avatarGeneratorSeed, setAvatarGeneratorSeed] = useState("");
  const [saving, setSaving] = useState(false);
  const [shareVisualWithHosts, setShareVisualWithHosts] = useState(false);
  const [shareVisualWithMembers, setShareVisualWithMembers] = useState(false);

  useEffect(() => {
    if (!isOpen || !config) return;
    setBg(config.profileBackground ?? "");
    setAvatar(config.profileAvatar ?? "");
    setFrame(config.profileFrame ?? "");
    setAvatarGeneratorSeed(activeProfile?.localUserId?.trim() || config.userId?.trim() || "");
    setShareVisualWithHosts(config.shareVisualProfileWithHosts ?? false);
    setShareVisualWithMembers(config.shareVisualProfileWithMembers ?? false);
  }, [activeProfile?.localUserId, config, isOpen]);

  const gamesCount = config?.games?.length ?? 0;
  const totalSeconds = config?.totalPlaytime ?? 0;
  const userId = activeProfile?.localUserId?.trim() || config?.userId?.trim() || "";
  const displayName = userId || "Usuario";
  const conn = connectionLabel(hasSyncConfig ? connectionStatus : undefined);

  const { data: cloudPresence = [], isLoading: cloudPresenceLoading } = useQuery({
    queryKey: ["cloud-presence"],
    queryFn: listCloudPresence,
    enabled: isOpen && !!userId,
    refetchInterval: 30_000,
  });
  useCloudPresenceRealtimeInvalidation(isOpen);

  const ownPresence = userId ? cloudPresence.find((item) => item.userId === userId) : undefined;
  const showPresenceChip = cloudPresenceLoading || ownPresence?.status !== "online";

  const lp = gamification?.levelProgress;
  const fallbackLevel = useMemo(
    () => Math.min(99, Math.max(1, Math.floor(Math.sqrt(Math.max(1, totalSeconds / 3600))) + 1)),
    [totalSeconds]
  );
  const level = lp?.level ?? fallbackLevel;
  const nextLevel = lp?.nextLevel;
  const progressToNext = lp?.progressToNextLevel ?? 0;
  const secondsToNext = lp?.secondsToNextLevel ?? 0;
  const atMaxLevel = (lp?.level ?? 0) >= 99;
  const progressPct = Math.round(progressToNext * 100);

  const uploadSuccessCount = gamification?.uploadSuccessCount ?? 0;
  const syncStreakDays = gamification?.syncStreakDays ?? 0;
  const playStreakDays = gamification?.playStreakDays ?? 0;
  const weeklyPlaytimeSeconds = gamification?.weeklyPlaytimeSeconds ?? 0;
  const achievementsUnlocked = gamification?.achievementsUnlocked ?? [];

  const frameResolved = useMemo(() => resolveProfileAsset(frame || undefined), [frame]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await setProfileAppearance({
        profileBackground: bg.trim() || null,
        profileAvatar: avatar.trim() || null,
        profileFrame: frame.trim() || null,
      });
      await setShareVisualProfileWithHosts(shareVisualWithHosts);
      await setShareVisualProfileWithMembers(shareVisualWithMembers);
      await queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
      scheduleConfigBackupToCloud();
      toastSuccess("Perfil actualizado", "Se guardó la apariencia del perfil.");
      onClose();
    } catch (e) {
      toastError("No se pudo guardar", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [avatar, bg, frame, onClose, queryClient, shareVisualWithHosts, shareVisualWithMembers]);

  const handleLogout = useCallback(() => {
    onClose();
    invoke("stop_cloud_ws").catch(() => {});
    queryClient.clear();
    useProfileSessionStore.getState().clearSession();
  }, [onClose, queryClient]);

  const pickFile = useCallback(async (kind: "background" | "avatar" | "frame") => {
    try {
      if (kind === "background") {
        const selected = await open({
          multiple: false,
          title: "Elegir imagen o vídeo de fondo",
          filters: [
            { name: "Imagen o vídeo", extensions: ["jpg", "jpeg", "png", "gif", "webp", "mp4", "webm", "mov"] },
          ],
        });
        if (typeof selected === "string") setBg(selected);
        return;
      }
      const selected = await open({
        multiple: false,
        title: kind === "avatar" ? "Elegir imagen de perfil" : "Elegir imagen de marco",
        filters: [{ name: "Imagen", extensions: ["jpg", "jpeg", "png", "gif", "webp"] }],
      });
      if (typeof selected === "string") {
        const dataUrl = await readImageAsDataUrl(selected);
        if (kind === "avatar") setAvatar(dataUrl);
        else setFrame(dataUrl);
      }
    } catch (e) {
      toastError("Archivo no válido", e instanceof Error ? e.message : String(e));
    }
  }, []);

  const applyGeneratedAvatar = useCallback((seed: string) => {
    const normalizedSeed = seed.trim() || generateNiceAvatarSeed();
    const generated = buildNiceAvatarConfig(normalizedSeed);
    setAvatar(serializeNiceAvatarConfig(generated));
  }, []);

  return (
    <Drawer
      isOpen={isOpen}
      onOpenChange={(openState) => {
        if (!openState) onClose();
      }}
      placement="right"
      size="lg"
      backdrop="blur"
      classNames={{
        base: bp ? "!w-[min(100%,min(96vw,44rem))] sm:!max-w-[min(96vw,44rem)] shadow-2xl" : "sm:max-w-lg",
        wrapper: bp
          ? `${
              bpReserveGlobalTopChromeSlot
                ? "overflow-hidden px-2 pt-[var(--savecloud-bp-library-header-h)] pb-3 sm:px-4 sm:pb-4"
                : "overflow-hidden px-2 pb-3 pt-[max(12px,env(safe-area-inset-top))] sm:px-4 sm:pb-4 sm:pt-4"
            } !z-[120]`
          : "overflow-hidden",
        backdrop: bp ? "!bg-black/45" : undefined,
      }}>
      <DrawerContent
        data-profile-console={bp ? "true" : undefined}
        className={`flex max-h-[min(100dvh,100vh)] flex-col rounded-l-3xl md:rounded-l-[28px] ${
          bp
            ? "border border-white/15 bg-[#121214] shadow-[0_24px_80px_-20px_rgba(0,0,0,0.85)] ring-1 ring-white/10 dark:border-white/10"
            : "bg-content1"
        }`}>
        <DrawerHeader
          className={`flex shrink-0 flex-col gap-0 border-b p-0 ${bp ? "border-white/15" : "border-default-200"}`}>
          <div
            className={`relative w-full overflow-hidden ${
              bp
                ? bg.trim()
                  ? "min-h-[min(52vh,32rem)] max-h-[min(60vh,36rem)]"
                  : "min-h-[min(44vh,22rem)] max-h-[min(52vh,28rem)]"
                : bg.trim()
                  ? "min-h-[min(55vh,28rem)] max-h-[min(65vh,32rem)]"
                  : "min-h-[min(42vh,18rem)] max-h-[min(50vh,22rem)]"
            }`}>
            {bg.trim() ? (
              <ProfileHeroBackground rawUrl={bg.trim()} imageMode="cover" />
            ) : (
              <div className="absolute inset-0 bg-[linear-gradient(125deg,#1b2838_0%,#0e1621_45%,#1b2838_100%)]" />
            )}
            {/* Botón Cambiar de Perfil en la parte superior derecha de la cabecera */}
            <div className="absolute right-4 top-4 z-30">
              <Button
                variant="flat"
                size="sm"
                radius="full"
                className="group min-w-0 w-9 h-9 p-0 backdrop-blur-md bg-black/40 border border-white/10 hover:bg-danger-500/15 hover:border-danger-500/30 text-white font-medium shadow-sm transition-all duration-300 ease-in-out hover:w-[128px] hover:pr-3 flex items-center justify-start overflow-hidden pl-[10px] active:scale-[0.95]"
                onPress={handleLogout}>
                <LogOut size={14} className="text-danger-400 shrink-0" />
                <span className="opacity-0 max-w-0 overflow-hidden transition-all duration-300 ease-in-out group-hover:opacity-100 group-hover:max-w-24 group-hover:ml-2 whitespace-nowrap text-xs text-danger-200 font-semibold select-none">
                  Cerrar sesión
                </span>
              </Button>
            </div>

            {/* Gradiente más oscuro y alto para máxima legibilidad */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-linear-to-t from-black/90 via-black/30 to-transparent z-10" />

            <div
              className={`absolute inset-x-0 bottom-0 flex items-end z-20 ${bp ? "gap-6 px-6 pb-5" : "gap-4 px-4 pb-3"}`}>
              {/* Avatar */}
              <div className={`relative shrink-0 ${bp ? "size-28 md:size-32" : "size-18"}`}>
                <div
                  className={`relative size-full overflow-hidden rounded-md border bg-black/30 shadow-lg ${
                    bp ? "border-white/25 ring-2 ring-black/80" : "border-white/10"
                  }`}>
                  {avatar.trim() ? (
                    <ProfileAvatarVisual rawAvatar={avatar} alt="user avatar" className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full items-center justify-center text-default-400">
                      <User size={bp ? 52 : 36} strokeWidth={1.2} />
                    </div>
                  )}
                </div>
                {frameResolved && (
                  <img
                    src={frameResolved}
                    alt="user frame"
                    decoding="async"
                    className="pointer-events-none absolute inset-0 size-full object-contain"
                  />
                )}
              </div>

              {/* Name + meta */}
              <div className={`min-w-0 flex-1 ${bp ? "pb-2" : "pb-1"}`}>
                <h2
                  className={`truncate font-semibold text-foreground drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] ${
                    bp ? "text-2xl md:text-[1.75rem] tracking-tight" : "text-lg"
                  }`}>
                  {displayName}
                </h2>
                <div className={`mt-1 flex flex-wrap items-center gap-2 ${bp ? "text-sm" : "text-xs"}`}>
                  <span className={`font-medium ${conn.tone} drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]`}>
                    {conn.text}
                  </span>
                  {showPresenceChip ? (
                    <span className="text-default-400 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">·</span>
                  ) : null}
                  {showPresenceChip ? (
                    <span className="inline-flex items-center drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
                      <PresenceStatusChip loading={cloudPresenceLoading} status={ownPresence?.status} />
                    </span>
                  ) : null}
                  <span className="text-default-400 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">·</span>
                  <span className="text-default-500 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
                    {formatPlaytime(totalSeconds)} jugados
                  </span>
                  <span className="text-default-400 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">·</span>
                  <span className="text-default-500 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
                    {gamesCount} {gamesCount === 1 ? "juego" : "juegos"}
                  </span>
                </div>
                {ownPresence?.status === "playing" && ownPresence?.gameName ? (
                  <p className={`mt-1 text-default-500 ${bp ? "text-sm" : "text-xs"}`}>
                    Jugando: {ownPresence.gameName}
                  </p>
                ) : null}
              </div>

              {/* Level badge */}
              <div className={`flex shrink-0 flex-col items-end gap-1 ${bp ? "pb-1.5" : "pb-0.5"}`}>
                <div
                  className={`flex items-center rounded-full border border-default-200/80 bg-default-100/80 dark:bg-default-50/10 ${
                    bp ? "gap-2 px-4 py-1 text-sm" : "gap-1.5 px-2.5 py-0.5 text-xs"
                  }`}>
                  <span className="text-default-500">Nivel</span>
                  <span
                    className={`flex items-center justify-center rounded-full border border-primary/40 bg-primary/10 font-semibold text-primary ${
                      bp ? "size-9 text-base" : "size-6"
                    }`}>
                    {level}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </DrawerHeader>

        <DrawerBody
          className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${bp ? "profile-drawer-console-scroll gap-5 px-6 py-5" : "gap-3 px-4 py-3"}`}>
          <div className={`grid grid-cols-4 ${bp ? "gap-3" : "gap-2"}`}>
            <div
              className={`flex flex-col items-center rounded-xl border bg-default-50/60 dark:bg-default-100/5 ${
                bp
                  ? "gap-2 border-white/15 py-4 ring-1 ring-white/[0.07]"
                  : "gap-1 rounded-lg border-default-200 py-2.5"
              }`}>
              <Gamepad2 size={bp ? 20 : 14} className="text-default-400" />
              <span className={`font-semibold text-foreground ${bp ? "text-xl" : "text-sm"}`}>{gamesCount}</span>
              <span
                className={`font-medium uppercase tracking-wider text-default-500 ${bp ? "text-xs" : "text-[10px]"}`}>
                Juegos
              </span>
            </div>
            <div
              className={`flex flex-col items-center rounded-xl border bg-default-50/60 dark:bg-default-100/5 ${
                bp
                  ? "gap-2 border-white/15 py-4 ring-1 ring-white/[0.07]"
                  : "gap-1 rounded-lg border-default-200 py-2.5"
              }`}>
              <Trophy size={bp ? 20 : 14} className="text-warning" />
              <span className={`font-semibold text-foreground ${bp ? "text-xl" : "text-sm"}`}>
                {achievementsUnlocked.length}
              </span>
              <span
                className={`font-medium uppercase tracking-wider text-default-500 ${bp ? "text-xs" : "text-[10px]"}`}>
                Logros
              </span>
            </div>
            <div
              className={`flex flex-col items-center rounded-xl border bg-default-50/60 dark:bg-default-100/5 ${
                bp
                  ? "gap-2 border-white/15 py-4 ring-1 ring-white/[0.07]"
                  : "gap-1 rounded-lg border-default-200 py-2.5"
              }`}>
              <CloudUpload size={bp ? 20 : 14} className="text-primary" />
              <span className={`font-semibold text-foreground ${bp ? "text-xl" : "text-sm"}`}>
                {uploadSuccessCount}
              </span>
              <span
                className={`font-medium uppercase tracking-wider text-default-500 ${bp ? "text-xs" : "text-[10px]"}`}>
                Subidas
              </span>
            </div>
            <div
              className={`flex flex-col items-center rounded-xl border bg-default-50/60 dark:bg-default-100/5 ${
                bp
                  ? "gap-2 border-white/15 py-4 ring-1 ring-white/[0.07]"
                  : "gap-1 rounded-lg border-default-200 py-2.5"
              }`}>
              <Flame size={bp ? 20 : 14} className={syncStreakDays > 0 ? "text-danger" : "text-default-400"} />
              <span className={`font-semibold text-foreground ${bp ? "text-xl" : "text-sm"}`}>{syncStreakDays}</span>
              <span
                className={`font-medium uppercase tracking-wider text-default-500 ${bp ? "text-xs" : "text-[10px]"}`}>
                {syncStreakDays === 1 ? "día racha" : "días racha"}
              </span>
            </div>
          </div>

          {(weeklyPlaytimeSeconds > 0 || playStreakDays > 0) && (
            <div
              className={`flex items-center rounded-xl border bg-default-50/60 dark:bg-default-100/5 ${
                bp
                  ? "gap-4 border-white/15 px-5 py-3.5 ring-1 ring-white/[0.07]"
                  : "gap-3 rounded-lg border-default-200 px-3 py-2"
              }`}>
              <Zap size={bp ? 20 : 14} className="shrink-0 text-warning" />
              <span className={`flex-1 text-default-600 ${bp ? "text-sm font-medium" : "text-xs"}`}>
                Esta semana:{" "}
                <span className="font-medium text-foreground">{formatPlaytime(weeklyPlaytimeSeconds)}</span> jugados
              </span>
              {playStreakDays > 0 && (
                <span className={`flex items-center gap-1 text-default-500 ${bp ? "gap-2 text-sm" : "text-xs"}`}>
                  <Flame size={bp ? 16 : 12} className="text-danger" />
                  {playStreakDays} {playStreakDays === 1 ? "día" : "días"} seguidos
                </span>
              )}
            </div>
          )}

          <div
            className={`border bg-default-50/60 dark:bg-default-100/5 ${
              bp ? "rounded-xl border-white/15 p-5 ring-1 ring-white/[0.07]" : "rounded-lg border-default-200 p-3"
            }`}>
            <div className={`mb-2 flex items-center justify-between gap-2 ${bp ? "mb-3" : ""}`}>
              <span
                className={`flex items-center font-medium text-foreground ${bp ? "gap-2 text-lg" : "gap-1.5 text-sm"}`}>
                <Trophy size={bp ? 22 : 15} className="text-warning" />
                Progreso de nivel
              </span>
              {!atMaxLevel && nextLevel != null ? (
                <span className={`text-default-500 ${bp ? "text-sm" : "text-xs"}`}>
                  Nivel {level} → {nextLevel}
                </span>
              ) : (
                <span className={`text-default-500 ${bp ? "text-sm" : "text-xs"}`}>Nivel máximo</span>
              )}
            </div>

            {!atMaxLevel ? (
              <>
                <div
                  className={`overflow-hidden rounded-full bg-default-200 dark:bg-default-100/20 ${bp ? "h-3" : "h-2"}`}>
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
                  />
                </div>
                <div className={`flex items-center justify-between ${bp ? "mt-2.5" : "mt-1.5"}`}>
                  <span className={`text-default-500 ${bp ? "text-sm" : "text-xs"}`}>{progressPct}% completado</span>
                  <span className={`flex items-center gap-1 text-default-500 ${bp ? "gap-2 text-sm" : "text-xs"}`}>
                    <Clock size={bp ? 14 : 11} />
                    {formatHoursToNextLevel(secondsToNext)} para nivel {nextLevel ?? "—"}
                  </span>
                </div>
              </>
            ) : (
              <p className={`text-default-500 ${bp ? "text-sm" : "text-xs"}`}>Has alcanzado el nivel 99.</p>
            )}

            {/* Achievements list */}
            {achievementsUnlocked.length > 0 && (
              <div className={bp ? "mt-5 border-t border-white/15 pt-4" : "mt-3 border-t border-default-200 pt-3"}>
                <p className={`mb-2 font-medium text-default-600 ${bp ? "mb-3 text-base" : "text-xs"}`}>
                  Logros desbloqueados
                </p>
                <ul className={`flex flex-col ${bp ? "gap-3" : "gap-2"}`}>
                  {achievementsUnlocked.map((id) => (
                    <li key={id} className={`flex items-center ${bp ? "gap-4" : "gap-2"}`}>
                      <span
                        className={`flex shrink-0 items-center justify-center rounded-md border bg-default-100 dark:bg-default-50/10 ${
                          bp ? "size-11 border-white/15" : "size-7 border-default-200"
                        }`}>
                        <AchievementIcon id={id} size={bp ? 18 : 14} />
                      </span>
                      <span className={`text-default-600 ${bp ? "text-sm font-medium" : "text-xs"}`}>
                        {achievementLabel(id)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <Accordion
            isCompact={!bp}
            selectionMode="multiple"
            defaultExpandedKeys={[]}
            className="px-0"
            itemClasses={{
              base: "px-0",
              title: bp ? "text-base font-bold uppercase tracking-[0.06em] text-default-600" : "text-sm font-medium",
              trigger: bp ? "min-h-[3.75rem] py-2 data-[hover=true]:bg-white/[0.06]" : "py-2",
              content: bp ? "pb-5 pt-1" : "pb-3 pt-0",
            }}>
            <AccordionItem
              key="bg"
              aria-label="Fondo"
              title={
                <span className={`flex items-center ${bp ? "gap-3 text-foreground" : "gap-2"}`}>
                  <MonitorPlay size={bp ? 20 : 15} className="text-default-500" />
                  Fondo
                </span>
              }>
              <div className={`flex flex-col ${bp ? "gap-3" : "gap-2"}`}>
                <Input
                  size={bp ? "lg" : "sm"}
                  label="URL"
                  placeholder="https://… · vacío quita el fondo"
                  value={bg}
                  onValueChange={setBg}
                  variant="bordered"
                  startContent={<Link2 size={bp ? 18 : 14} className="text-default-400" />}
                />
                <Button
                  size={bp ? "lg" : "sm"}
                  variant="bordered"
                  className={`w-full justify-start ${bp ? "min-h-12 text-base" : ""}`}
                  startContent={<FolderOpen size={bp ? 20 : 16} />}
                  onPress={() => void pickFile("background")}>
                  Archivo en disco…
                </Button>
              </div>
            </AccordionItem>

            <AccordionItem
              key="avatar"
              aria-label="Foto de perfil"
              title={
                <span className={`flex items-center ${bp ? "gap-3 text-foreground" : "gap-2"}`}>
                  <ImageIcon size={bp ? 20 : 15} className="text-default-500" />
                  Foto de perfil
                </span>
              }>
              <div className={`flex flex-col ${bp ? "gap-3" : "gap-2"}`}>
                <Input
                  size={bp ? "lg" : "sm"}
                  label="URL"
                  placeholder="https://…"
                  value={avatar}
                  onValueChange={setAvatar}
                  variant="bordered"
                  startContent={<Link2 size={bp ? 18 : 14} className="text-default-400" />}
                />
                <Button
                  size={bp ? "lg" : "sm"}
                  variant="bordered"
                  className={`w-full justify-start ${bp ? "min-h-12 text-base" : ""}`}
                  startContent={<FolderOpen size={bp ? 20 : 16} />}
                  onPress={() => void pickFile("avatar")}>
                  Imagen local…
                </Button>

                <div
                  className={`mt-1 rounded-xl border bg-default-50/60 dark:bg-default-100/5 ${
                    bp ? "border-white/15 p-4 ring-1 ring-white/[0.07]" : "rounded-lg border-default-200 p-2.5"
                  }`}>
                  <p className={`mb-2 font-medium text-default-600 ${bp ? "mb-3 text-base" : "text-xs"}`}>
                    Avatar generado con librería
                  </p>
                  <div className={`flex items-center ${bp ? "gap-4" : "gap-2"}`}>
                    <div
                      className={`relative overflow-hidden rounded-md border bg-default-100/60 dark:border-default-100/35 dark:bg-default-50/20 ${
                        bp ? "size-20 border-white/15" : "size-14 border-default-200"
                      }`}>
                      <ProfileAvatarVisual rawAvatar={avatar} alt="preview" className="size-full object-cover" />
                    </div>
                    <Input
                      size={bp ? "lg" : "sm"}
                      label="Semilla"
                      placeholder="nombre, email o texto"
                      value={avatarGeneratorSeed}
                      onValueChange={setAvatarGeneratorSeed}
                      variant="bordered"
                      className="flex-1"
                    />
                  </div>
                  <div className={`mt-2 grid grid-cols-2 ${bp ? "gap-3" : "gap-2"}`}>
                    <Button
                      size={bp ? "lg" : "sm"}
                      variant="flat"
                      className={bp ? "min-h-12 text-base font-medium" : ""}
                      onPress={() => applyGeneratedAvatar(avatarGeneratorSeed)}>
                      Usar semilla
                    </Button>
                    <Button
                      size={bp ? "lg" : "sm"}
                      variant="flat"
                      className={bp ? "min-h-12 text-base font-medium" : ""}
                      startContent={<RefreshCw size={bp ? 18 : 14} />}
                      onPress={() => {
                        const seed = generateNiceAvatarSeed();
                        setAvatarGeneratorSeed(seed);
                        applyGeneratedAvatar(seed);
                      }}>
                      Aleatorio
                    </Button>
                  </div>
                </div>
              </div>
            </AccordionItem>

            <AccordionItem
              key="frame"
              aria-label="Marco"
              title={
                <span className={`flex items-center ${bp ? "gap-3 text-foreground" : "gap-2"}`}>
                  <Layers size={bp ? 20 : 15} className="text-default-500" />
                  Marco
                </span>
              }>
              <div className={`flex flex-col ${bp ? "gap-3" : "gap-2"}`}>
                <Input
                  size={bp ? "lg" : "sm"}
                  label="URL"
                  placeholder="PNG con transparencia"
                  value={frame}
                  onValueChange={setFrame}
                  variant="bordered"
                  startContent={<Link2 size={bp ? 18 : 14} className="text-default-400" />}
                />
                <Button
                  size={bp ? "lg" : "sm"}
                  variant="bordered"
                  className={`w-full justify-start ${bp ? "min-h-12 text-base" : ""}`}
                  startContent={<FolderOpen size={bp ? 20 : 16} />}
                  onPress={() => void pickFile("frame")}>
                  Imagen local…
                </Button>
              </div>
            </AccordionItem>

            <AccordionItem
              key="sharing"
              aria-label="Privacidad en la nube"
              title={
                <span className={`flex items-center ${bp ? "gap-3 text-foreground" : "gap-2"}`}>
                  <Shield size={bp ? 20 : 15} className="text-default-500" />
                  Privacidad en la nube
                </span>
              }>
              <div className={`flex flex-col ${bp ? "gap-4" : "gap-2"}`}>
                <Switch
                  isSelected={shareVisualWithHosts}
                  onValueChange={setShareVisualWithHosts}
                  size={bp ? "lg" : "sm"}
                  classNames={
                    bp
                      ? { label: "text-base font-semibold text-foreground", base: "gap-4" }
                      : { label: "text-sm text-foreground" }
                  }>
                  Compartir con anfitriones
                </Switch>
                <p className={`leading-snug text-default-500 ${bp ? "text-sm" : "text-[11px]"}`}>
                  Quienes te invitaron como miembro podrán ver fondo, avatar y marco al cargar tu usuario en Amigos.
                </p>
                <Switch
                  isSelected={shareVisualWithMembers}
                  onValueChange={setShareVisualWithMembers}
                  size={bp ? "lg" : "sm"}
                  classNames={
                    bp
                      ? { label: "text-base font-semibold text-foreground", base: "gap-4" }
                      : { label: "text-sm text-foreground" }
                  }>
                  Compartir con miembros de tu nube
                </Switch>
                <p className={`leading-snug text-default-500 ${bp ? "text-sm" : "text-[11px]"}`}>
                  Si eres anfitrión, los miembros de tu nube podrán ver tu perfil visual en Amigos.
                </p>
              </div>
            </AccordionItem>

            <AccordionItem
              key="help"
              aria-label="Ayuda"
              title={
                <span className={`flex items-center ${bp ? "gap-3 text-foreground" : "gap-2"}`}>
                  <CircleHelp size={bp ? 20 : 15} className="text-default-500" />
                  Ayuda
                </span>
              }>
              <p className={`leading-snug text-default-500 ${bp ? "text-sm" : "text-[11px]"}`}>
                Puedes usar enlaces https o rutas a archivos locales. Las rutas locales dependen del archivo en disco;
                si mueves o borras el archivo, el perfil dejará de mostrarlo.
              </p>
            </AccordionItem>
          </Accordion>

          <div
            className={`mt-auto flex shrink-0 border-t pt-3 ${
              bp ? "gap-3 border-white/15 pt-5" : "gap-2 border-default-200"
            }`}>
            <Button
              variant="flat"
              size={bp ? "lg" : "md"}
              className={`flex-1 ${bp ? "min-h-14 text-base font-semibold" : ""}`}
              onPress={onClose}>
              Cancelar
            </Button>
            <Button
              color="primary"
              size={bp ? "lg" : "md"}
              className={`flex-1 ${bp ? "min-h-14 text-base font-semibold" : ""}`}
              isLoading={saving}
              startContent={<Save size={bp ? 22 : 18} />}
              onPress={() => void handleSave()}>
              Guardar
            </Button>
          </div>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
