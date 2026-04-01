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
import { FolderOpen, ImageIcon, Layers, Link2, MonitorPlay, Save, Trophy, User } from "lucide-react";
import { ProfileHeroBackground } from "@features/profile/PublicProfileHero";
import { useQueryClient } from "@tanstack/react-query";
import type { Config } from "@app-types/config";
import type { GamificationState } from "@app-types/gamification";
import type { ConnectionStatus } from "@hooks/useLastSyncInfo";
import { CONFIG_QUERY_KEY } from "@hooks/useConfig";
import {
  readImageAsDataUrl,
  scheduleConfigBackupToCloud,
  setProfileAppearance,
  setShareVisualProfileWithHosts,
  setShareVisualProfileWithMembers,
} from "@services/tauri";
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

export function ProfileDrawer({
  isOpen,
  onClose,
  config,
  gamification,
  hasSyncConfig,
  connectionStatus,
}: ProfileDrawerProps) {
  const queryClient = useQueryClient();
  const [bg, setBg] = useState("");
  const [avatar, setAvatar] = useState("");
  const [frame, setFrame] = useState("");
  const [saving, setSaving] = useState(false);
  const [shareVisualWithHosts, setShareVisualWithHosts] = useState(false);
  const [shareVisualWithMembers, setShareVisualWithMembers] = useState(false);

  useEffect(() => {
    if (!isOpen || !config) return;
    setBg(config.profileBackground ?? "");
    setAvatar(config.profileAvatar ?? "");
    setFrame(config.profileFrame ?? "");
    setShareVisualWithHosts(config.shareVisualProfileWithHosts ?? false);
    setShareVisualWithMembers(config.shareVisualProfileWithMembers ?? false);
  }, [isOpen, config]);

  const gamesCount = config?.games?.length ?? 0;
  const totalSeconds = config?.totalPlaytime ?? 0;
  const userId = config?.userId?.trim() ?? "";
  const displayName = userId || "Usuario";
  const conn = connectionLabel(hasSyncConfig ? connectionStatus : undefined);

  const fallbackLevel = useMemo(
    () => Math.min(99, Math.max(1, Math.floor(Math.sqrt(Math.max(1, totalSeconds / 3600))) + 1)),
    [totalSeconds]
  );
  const lp = gamification?.levelProgress;
  const level = lp?.level ?? fallbackLevel;
  const nextLevel = lp?.nextLevel;
  const progressToNext = lp?.progressToNextLevel ?? 0;
  const secondsToNext = lp?.secondsToNextLevel ?? 0;
  const atMaxLevel = (lp?.level ?? 0) >= 99;

  const avatarResolved = useMemo(() => resolveProfileAsset(avatar || undefined), [avatar]);
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
        if (typeof selected === "string") {
          setBg(selected);
        }
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
          {/* Zona de fondo: más alta cuando hay media (hasta ~55vh / 28rem) */}
          <div
            className={`relative w-full overflow-hidden ${
              bg.trim()
                ? "min-h-[min(55vh,28rem)] max-h-[min(65vh,32rem)]"
                : "min-h-[min(42vh,18rem)] max-h-[min(50vh,22rem)]"
            }`}>
            {bg.trim() ? (
              <ProfileHeroBackground rawUrl={bg.trim()} />
            ) : (
              <div className="absolute inset-0 bg-[linear-gradient(125deg,#1b2838_0%,#0e1621_45%,#1b2838_100%)]" />
            )}
            <div className="absolute inset-0 bg-linear-to-t from-content1 via-content1/45 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 flex items-end gap-4 px-4 pb-3">
              <div className="relative size-[72px] shrink-0">
                <div className="relative size-full overflow-hidden rounded-md border border-white/10 bg-black/30 shadow-lg">
                  {avatarResolved ? (
                    <img src={avatarResolved} alt="" decoding="async" className="size-full object-cover" />
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
              <div className="min-w-0 flex-1 pb-1">
                <h2 className="truncate text-lg font-semibold text-foreground">{displayName}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className={`font-medium ${conn.tone}`}>{conn.text}</span>
                  <span className="text-default-400">·</span>
                  <span className="text-default-500">{formatPlaytime(totalSeconds)} jugados</span>
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
                    {level}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </DrawerHeader>

        <DrawerBody className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          <p className="text-[11px] leading-snug text-default-500">
            Enlaces https o archivos locales. Las rutas locales dependen del archivo en disco.
          </p>

          <div className="flex flex-col gap-2 rounded-lg border border-default-200 bg-default-50/60 p-3 dark:bg-default-100/5">
            <Switch
              isSelected={shareVisualWithHosts}
              onValueChange={setShareVisualWithHosts}
              size="sm"
              classNames={{ label: "text-sm text-foreground" }}>
              Compartir perfil visual con anfitriones de nubes compartidas
            </Switch>
            <p className="text-[11px] leading-snug text-default-500">
              Si lo activas, quienes te invitaron como miembro podrán ver fondo, avatar y marco al cargar tu usuario en
              Amigos (no aplica a cualquier persona que escriba tu ID).
            </p>
            <Switch
              isSelected={shareVisualWithMembers}
              onValueChange={setShareVisualWithMembers}
              size="sm"
              classNames={{ label: "text-sm text-foreground" }}>
              Compartir perfil visual con miembros de tu nube
            </Switch>
            <p className="text-[11px] leading-snug text-default-500">
              Si eres anfitrión y lo activas, quienes están en tu nube como miembros podrán ver tu perfil visual al
              cargar tu usuario en Amigos.
            </p>
          </div>

          <div className="rounded-lg border border-default-200 bg-default-50/60 p-3 dark:bg-default-100/5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Trophy size={16} className="text-warning" />
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
                    style={{ width: `${Math.min(100, Math.max(0, progressToNext * 100))}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-default-500">
                  Faltan {formatHoursToNextLevel(secondsToNext)} para el nivel {nextLevel ?? "—"}
                </p>
              </>
            ) : (
              <p className="text-xs text-default-500">Has alcanzado el nivel 99.</p>
            )}
            {gamification?.achievementsUnlocked?.length ? (
              <div className="mt-3 border-t border-default-200 pt-3">
                <p className="mb-2 text-xs font-medium text-default-600">Logros</p>
                <ul className="flex flex-col gap-1.5">
                  {gamification.achievementsUnlocked.map((id) => (
                    <li key={id} className="text-xs text-default-600">
                      · {achievementLabel(id)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <Accordion
            isCompact
            selectionMode="multiple"
            defaultExpandedKeys={["bg"]}
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
              aria-label="Avatar"
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
