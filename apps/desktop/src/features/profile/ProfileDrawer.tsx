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
} from "lucide-react";
import { ProfileAvatarVisual } from "@features/profile/ProfileAvatarVisual";
import { ProfileHeroBackground } from "@features/profile/PublicProfileHero";
import { buildNiceAvatarConfig, generateNiceAvatarSeed, serializeNiceAvatarConfig } from "@features/profile/niceAvatar";
import { PresenceStatusChip } from "@features/friends/PresenceStatusChip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Config } from "@app-types/config";
import type { GamificationState } from "@app-types/gamification";
import type { ConnectionStatus } from "@hooks/useLastSyncInfo";
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
}: ProfileDrawerProps) {
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

  const ownPresence = userId ? cloudPresence.find((item) => item.userId === userId) : undefined;

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
      backdrop="opaque"
      classNames={{
        base: "sm:max-w-lg",
        wrapper: "overflow-hidden",
      }}>
      <DrawerContent className="flex max-h-dvh flex-col bg-content1">
        <DrawerHeader className="flex shrink-0 flex-col gap-0 border-b border-default-200 p-0">
          <div
            className={`relative w-full overflow-hidden ${
              bg.trim()
                ? "min-h-[min(55vh,28rem)] max-h-[min(65vh,32rem)]"
                : "min-h-[min(42vh,18rem)] max-h-[min(50vh,22rem)]"
            }`}>
            {bg.trim() ? (
              <ProfileHeroBackground rawUrl={bg.trim()} imageMode="cover" />
            ) : (
              <div className="absolute inset-0 bg-[linear-gradient(125deg,#1b2838_0%,#0e1621_45%,#1b2838_100%)]" />
            )}
            <div className="absolute inset-0 bg-linear-to-t from-content1 via-content1/45 to-transparent" />

            <div className="absolute inset-x-0 bottom-0 flex items-end gap-4 px-4 pb-3">
              {/* Avatar */}
              <div className="relative size-18 shrink-0">
                <div className="relative size-full overflow-hidden rounded-md border border-white/10 bg-black/30 shadow-lg">
                  {avatar.trim() ? (
                    <ProfileAvatarVisual rawAvatar={avatar} alt="user avatar" className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full items-center justify-center text-default-400">
                      <User size={36} strokeWidth={1.2} />
                    </div>
                  )}
                </div>
                {frameResolved && (
                  <img
                    src={frameResolved}
                    alt=""
                    decoding="async"
                    className="pointer-events-none absolute inset-0 size-full object-contain"
                  />
                )}
              </div>

              {/* Name + meta */}
              <div className="min-w-0 flex-1 pb-1">
                <h2 className="truncate text-lg font-semibold text-foreground">{displayName}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className={`font-medium ${conn.tone}`}>{conn.text}</span>
                  <span className="text-default-400">·</span>
                  <span className="inline-flex items-center">
                    <PresenceStatusChip loading={cloudPresenceLoading} status={ownPresence?.status} />
                  </span>
                  <span className="text-default-400">·</span>
                  <span className="text-default-500">{formatPlaytime(totalSeconds)} jugados</span>
                  <span className="text-default-400">·</span>
                  <span className="text-default-500">
                    {gamesCount} {gamesCount === 1 ? "juego" : "juegos"}
                  </span>
                </div>
                {ownPresence?.status === "playing" && ownPresence?.gameName ? (
                  <p className="mt-1 text-xs text-default-500">Jugando: {ownPresence.gameName}</p>
                ) : null}
              </div>

              {/* Level badge */}
              <div className="flex shrink-0 flex-col items-end gap-1 pb-0.5">
                <div className="flex items-center gap-1.5 rounded-full border border-default-200/80 bg-default-100/80 px-2.5 py-0.5 text-xs dark:bg-default-50/10">
                  <span className="text-default-500">Nivel</span>
                  <span className="flex size-6 items-center justify-center rounded-full border border-primary/40 bg-primary/10 font-semibold text-primary">
                    {level}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </DrawerHeader>

        <DrawerBody className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          <div className="grid grid-cols-4 gap-2">
            <div className="flex flex-col items-center gap-1 rounded-lg border border-default-200 bg-default-50/60 py-2.5 dark:bg-default-100/5">
              <Gamepad2 size={14} className="text-default-400" />
              <span className="text-sm font-semibold text-foreground">{gamesCount}</span>
              <span className="text-[10px] text-default-500">Juegos</span>
            </div>
            <div className="flex flex-col items-center gap-1 rounded-lg border border-default-200 bg-default-50/60 py-2.5 dark:bg-default-100/5">
              <Trophy size={14} className="text-warning" />
              <span className="text-sm font-semibold text-foreground">{achievementsUnlocked.length}</span>
              <span className="text-[10px] text-default-500">Logros</span>
            </div>
            <div className="flex flex-col items-center gap-1 rounded-lg border border-default-200 bg-default-50/60 py-2.5 dark:bg-default-100/5">
              <CloudUpload size={14} className="text-primary" />
              <span className="text-sm font-semibold text-foreground">{uploadSuccessCount}</span>
              <span className="text-[10px] text-default-500">Subidas</span>
            </div>
            <div className="flex flex-col items-center gap-1 rounded-lg border border-default-200 bg-default-50/60 py-2.5 dark:bg-default-100/5">
              <Flame size={14} className={syncStreakDays > 0 ? "text-danger" : "text-default-400"} />
              <span className="text-sm font-semibold text-foreground">{syncStreakDays}</span>
              <span className="text-[10px] text-default-500">{syncStreakDays === 1 ? "día racha" : "días racha"}</span>
            </div>
          </div>

          {(weeklyPlaytimeSeconds > 0 || playStreakDays > 0) && (
            <div className="flex items-center gap-3 rounded-lg border border-default-200 bg-default-50/60 px-3 py-2 dark:bg-default-100/5">
              <Zap size={14} className="shrink-0 text-warning" />
              <span className="flex-1 text-xs text-default-600">
                Esta semana:{" "}
                <span className="font-medium text-foreground">{formatPlaytime(weeklyPlaytimeSeconds)}</span> jugados
              </span>
              {playStreakDays > 0 && (
                <span className="flex items-center gap-1 text-xs text-default-500">
                  <Flame size={12} className="text-danger" />
                  {playStreakDays} {playStreakDays === 1 ? "día" : "días"} seguidos
                </span>
              )}
            </div>
          )}

          <div className="rounded-lg border border-default-200 bg-default-50/60 p-3 dark:bg-default-100/5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Trophy size={15} className="text-warning" />
                Progreso de nivel
              </span>
              {!atMaxLevel && nextLevel != null ? (
                <span className="text-xs text-default-500">
                  Nivel {level} → {nextLevel}
                </span>
              ) : (
                <span className="text-xs text-default-500">Nivel máximo</span>
              )}
            </div>

            {!atMaxLevel ? (
              <>
                <div className="h-2 overflow-hidden rounded-full bg-default-200 dark:bg-default-100/20">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="text-xs text-default-500">{progressPct}% completado</span>
                  <span className="flex items-center gap-1 text-xs text-default-500">
                    <Clock size={11} />
                    {formatHoursToNextLevel(secondsToNext)} para nivel {nextLevel ?? "—"}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-xs text-default-500">Has alcanzado el nivel 99.</p>
            )}

            {/* Achievements list */}
            {achievementsUnlocked.length > 0 && (
              <div className="mt-3 border-t border-default-200 pt-3">
                <p className="mb-2 text-xs font-medium text-default-600">Logros desbloqueados</p>
                <ul className="flex flex-col gap-2">
                  {achievementsUnlocked.map((id) => (
                    <li key={id} className="flex items-center gap-2">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-default-200 bg-default-100 dark:bg-default-50/10">
                        <AchievementIcon id={id} size={14} />
                      </span>
                      <span className="text-xs text-default-600">{achievementLabel(id)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <Accordion
            isCompact
            selectionMode="multiple"
            defaultExpandedKeys={[]}
            className="px-0"
            itemClasses={{
              base: "px-0",
              title: "text-sm font-medium",
              trigger: "py-2",
              content: "pb-3 pt-0",
            }}>
            <AccordionItem
              key="bg"
              aria-label="Fondo"
              title={
                <span className="flex items-center gap-2">
                  <MonitorPlay size={15} className="text-default-500" />
                  Fondo
                </span>
              }>
              <div className="flex flex-col gap-2">
                <Input
                  size="sm"
                  label="URL"
                  placeholder="https://… · vacío quita el fondo"
                  value={bg}
                  onValueChange={setBg}
                  variant="bordered"
                  startContent={<Link2 size={14} className="text-default-400" />}
                />
                <Button
                  size="sm"
                  variant="bordered"
                  className="w-full justify-start"
                  startContent={<FolderOpen size={16} />}
                  onPress={() => void pickFile("background")}>
                  Archivo en disco…
                </Button>
              </div>
            </AccordionItem>

            <AccordionItem
              key="avatar"
              aria-label="Foto de perfil"
              title={
                <span className="flex items-center gap-2">
                  <ImageIcon size={15} className="text-default-500" />
                  Foto de perfil
                </span>
              }>
              <div className="flex flex-col gap-2">
                <Input
                  size="sm"
                  label="URL"
                  placeholder="https://…"
                  value={avatar}
                  onValueChange={setAvatar}
                  variant="bordered"
                  startContent={<Link2 size={14} className="text-default-400" />}
                />
                <Button
                  size="sm"
                  variant="bordered"
                  className="w-full justify-start"
                  startContent={<FolderOpen size={16} />}
                  onPress={() => void pickFile("avatar")}>
                  Imagen local…
                </Button>

                <div className="mt-1 rounded-lg border border-default-200 bg-default-50/60 p-2.5 dark:bg-default-100/5">
                  <p className="mb-2 text-xs font-medium text-default-600">Avatar generado con librería</p>
                  <div className="flex items-center gap-2">
                    <div className="relative size-14 overflow-hidden rounded-md border border-default-200 bg-default-100/60 dark:border-default-100/35 dark:bg-default-50/20">
                      <ProfileAvatarVisual rawAvatar={avatar} alt="preview" className="size-full object-cover" />
                    </div>
                    <Input
                      size="sm"
                      label="Semilla"
                      placeholder="nombre, email o texto"
                      value={avatarGeneratorSeed}
                      onValueChange={setAvatarGeneratorSeed}
                      variant="bordered"
                      className="flex-1"
                    />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button size="sm" variant="flat" onPress={() => applyGeneratedAvatar(avatarGeneratorSeed)}>
                      Usar semilla
                    </Button>
                    <Button
                      size="sm"
                      variant="flat"
                      startContent={<RefreshCw size={14} />}
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
                <span className="flex items-center gap-2">
                  <Layers size={15} className="text-default-500" />
                  Marco
                </span>
              }>
              <div className="flex flex-col gap-2">
                <Input
                  size="sm"
                  label="URL"
                  placeholder="PNG con transparencia"
                  value={frame}
                  onValueChange={setFrame}
                  variant="bordered"
                  startContent={<Link2 size={14} className="text-default-400" />}
                />
                <Button
                  size="sm"
                  variant="bordered"
                  className="w-full justify-start"
                  startContent={<FolderOpen size={16} />}
                  onPress={() => void pickFile("frame")}>
                  Imagen local…
                </Button>
              </div>
            </AccordionItem>

            <AccordionItem
              key="sharing"
              aria-label="Privacidad en la nube"
              title={
                <span className="flex items-center gap-2">
                  <Shield size={15} className="text-default-500" />
                  Privacidad en la nube
                </span>
              }>
              <div className="flex flex-col gap-2">
                <Switch
                  isSelected={shareVisualWithHosts}
                  onValueChange={setShareVisualWithHosts}
                  size="sm"
                  classNames={{ label: "text-sm text-foreground" }}>
                  Compartir con anfitriones
                </Switch>
                <p className="text-[11px] leading-snug text-default-500">
                  Quienes te invitaron como miembro podrán ver fondo, avatar y marco al cargar tu usuario en Amigos.
                </p>
                <Switch
                  isSelected={shareVisualWithMembers}
                  onValueChange={setShareVisualWithMembers}
                  size="sm"
                  classNames={{ label: "text-sm text-foreground" }}>
                  Compartir con miembros de tu nube
                </Switch>
                <p className="text-[11px] leading-snug text-default-500">
                  Si eres anfitrión, los miembros de tu nube podrán ver tu perfil visual en Amigos.
                </p>
              </div>
            </AccordionItem>

            <AccordionItem
              key="help"
              aria-label="Ayuda"
              title={
                <span className="flex items-center gap-2">
                  <CircleHelp size={15} className="text-default-500" />
                  Ayuda
                </span>
              }>
              <p className="text-[11px] leading-snug text-default-500">
                Puedes usar enlaces https o rutas a archivos locales. Las rutas locales dependen del archivo en disco;
                si mueves o borras el archivo, el perfil dejará de mostrarlo.
              </p>
            </AccordionItem>
          </Accordion>

          <div className="mt-auto flex shrink-0 gap-2 border-t border-default-200 pt-3">
            <Button variant="flat" className="flex-1" onPress={onClose}>
              Cancelar
            </Button>
            <Button
              color="primary"
              className="flex-1"
              isLoading={saving}
              startContent={<Save size={18} />}
              onPress={() => void handleSave()}>
              Guardar
            </Button>
          </div>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
