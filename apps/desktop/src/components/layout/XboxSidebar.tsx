import { useMemo } from "react";
import { Avatar, Button, Tooltip } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { Gamepad2, History, Library, MonitorPlay, Moon, Settings, Sun, Users } from "lucide-react";
import { ProfileAvatarVisual } from "@features/profile/ProfileAvatarVisual";
import { resolveProfileAsset } from "@utils/profileMedia";
import { NotificationCenter } from "@components/layout/NotificationCenter";
import { CloudMembersLauncher } from "@features/friends/CloudMembersLauncher";
import { openOrFocusSettingsWindow } from "@/windows/settingsWindow";
import type { ConnectionStatus } from "@hooks/useLastSyncInfo";

export interface XboxSidebarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  userId?: string | null;
  profileAvatar?: string | null;
  profileFrame?: string | null;
  hasSyncConfig?: boolean;
  connectionStatus?: ConnectionStatus;
  onOpenProfile: () => void;
  onIntentOpenProfile?: () => void;
}

interface XboxNavItem {
  id: string;
  translationKey: string;
  fallbackLabel: string;
  icon: React.ReactNode;
}

const XBOX_NAV_ITEMS: XboxNavItem[] = [
  { id: "/", translationKey: "nav.library", fallbackLabel: "Biblioteca", icon: <Gamepad2 size={22} /> },
  { id: "/catalog", translationKey: "nav.catalog", fallbackLabel: "Catálogo", icon: <Library size={22} /> },
  {
    id: "/remote-play",
    translationKey: "nav.remotePlay",
    fallbackLabel: "Remote Play",
    icon: <MonitorPlay size={22} />,
  },
  { id: "/friends", translationKey: "nav.social", fallbackLabel: "Social", icon: <Users size={22} /> },
  { id: "/history", translationKey: "nav.activity", fallbackLabel: "Actividad", icon: <History size={22} /> },
];

export function XboxSidebar({
  currentPath,
  onNavigate,
  userId,
  profileAvatar,
  profileFrame,
  hasSyncConfig,
  connectionStatus,
  onOpenProfile,
  onIntentOpenProfile,
}: XboxSidebarProps) {
  const { t } = useTranslation();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const isConfigured = !!userId?.trim();

  const frameSrc = useMemo(() => resolveProfileAsset(profileFrame ?? undefined), [profileFrame]);

  return (
    <aside
      className="fixed left-0 top-0 bottom-0 w-17 z-40 flex flex-col justify-between items-center py-3.5 px-2 bg-background/80 dark:bg-background/85 backdrop-blur-2xl border-r border-default-200/40 dark:border-default-100/10 select-none shadow-xs"
      aria-label="Barra de navegación principal">
      {/* Sección superior: Avatar y Perfil de Usuario */}
      <div className="flex flex-col items-center gap-4 w-full">
        <Tooltip
          content={
            isConfigured ? (
              <div className="flex flex-col gap-0.5 py-0.5">
                <span className="font-semibold text-foreground">{userId}</span>
                <span className="text-[11px] text-default-400">
                  {connectionStatus === "connected"
                    ? t("common.connection.online", "En línea")
                    : connectionStatus === "connecting"
                      ? t("common.connection.connecting", "Conectando...")
                      : connectionStatus === "error"
                        ? t("common.connection.offline", "Sin conexión")
                        : t("profile.openProfile", "Ver Perfil")}
                </span>
              </div>
            ) : (
              t("library.userBadge.notConfigured", "Configurar Perfil")
            )
          }
          placement="right"
          delay={150}
          closeDelay={0}>
          <button
            type="button"
            onClick={onOpenProfile}
            onPointerEnter={() => onIntentOpenProfile?.()}
            onFocus={() => onIntentOpenProfile?.()}
            className="group relative size-11 rounded-2xl flex items-center justify-center transition-all duration-300 hover:scale-105 cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={t("profile.openProfile", "Abrir Perfil")}>
            <div className="relative size-10 rounded-xl overflow-hidden border border-default-200/80 bg-default-100/60 dark:border-default-100/30 dark:bg-default-50/20 shadow-inner group-hover:border-primary/60 transition-colors">
              {profileAvatar ? (
                <ProfileAvatarVisual rawAvatar={profileAvatar} alt="avatar" className="size-full object-cover" />
              ) : (
                <Avatar
                  size="sm"
                  radius="none"
                  showFallback
                  classNames={{
                    base: "size-full min-h-10 min-w-10 rounded-xl bg-primary/15 text-primary font-bold",
                    img: "object-cover",
                  }}
                  name={userId ? userId.slice(0, 2).toUpperCase() : undefined}
                />
              )}
            </div>

            {frameSrc ? (
              <img
                src={frameSrc}
                alt=""
                className="pointer-events-none absolute inset-0 z-10 size-full object-contain opacity-[0.95]"
              />
            ) : null}

            {/* Punto indicador de estado circular */}
            {hasSyncConfig && (
              <span
                className={`absolute -bottom-0.5 -right-0.5 z-20 size-3 rounded-full ring-2 ring-background ${
                  connectionStatus === "connected"
                    ? "bg-emerald-500 shadow-xs"
                    : connectionStatus === "connecting" || connectionStatus === "retrying"
                      ? "bg-amber-500 animate-pulse"
                      : connectionStatus === "error"
                        ? "bg-rose-500"
                        : "bg-default-400"
                }`}
                aria-hidden="true"
              />
            )}
          </button>
        </Tooltip>

        <div className="w-8 h-px bg-default-200/50 dark:bg-default-100/15" />

        {/* Navegación principal con animación fluida entre elementos */}
        <nav className="flex flex-col items-center gap-2 w-full">
          {XBOX_NAV_ITEMS.map((item) => {
            const isActive = currentPath === item.id;
            const label = t(item.translationKey, item.fallbackLabel);

            return (
              <Tooltip key={item.id} content={label} placement="right" delay={150} closeDelay={0}>
                <button
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={`group relative size-11 rounded-2xl flex items-center justify-center cursor-pointer transition-colors duration-200 ${
                    isActive
                      ? "text-primary dark:text-primary-400 font-semibold"
                      : "text-default-400 hover:text-foreground hover:bg-default-100/60 dark:hover:bg-default-100/10"
                  }`}
                  aria-label={label}
                  aria-current={isActive ? "page" : undefined}>
                  {/* Cápsula de fondo animada que se desliza al cambiar de ítem */}
                  {isActive && (
                    <motion.div
                      layoutId="xbox-nav-active-pill"
                      transition={{ type: "spring", stiffness: 420, damping: 32 }}
                      className="absolute inset-0 rounded-2xl bg-default-200/80 dark:bg-default-100/25 shadow-xs pointer-events-none"
                    />
                  )}

                  {/* Indicador de barra vertical que se desliza suavemente */}
                  {isActive && (
                    <motion.span
                      layoutId="xbox-nav-active-bar"
                      transition={{ type: "spring", stiffness: 420, damping: 32 }}
                      className="absolute -left-2 top-2.5 bottom-2.5 w-1 rounded-r-full bg-primary pointer-events-none"
                    />
                  )}

                  <div className="relative z-10 transition-transform duration-200 group-hover:scale-110 group-active:scale-95">
                    {item.icon}
                  </div>
                </button>
              </Tooltip>
            );
          })}
        </nav>
      </div>

      {/* Sección inferior: Notificaciones, Amigos, Ajustes y Tema */}
      <div className="flex flex-col items-center gap-2 w-full pt-2">
        <div className="w-8 h-px bg-default-200/50 dark:bg-default-100/15 mb-1" />

        <Tooltip content={t("nav.socialMembers", "Miembros Cloud")} placement="right" delay={150} closeDelay={0}>
          <div className="flex items-center justify-center cursor-pointer">
            <CloudMembersLauncher />
          </div>
        </Tooltip>

        <Tooltip content={t("notifications.title", "Notificaciones")} placement="right" delay={150} closeDelay={0}>
          <div className="flex items-center justify-center cursor-pointer">
            <NotificationCenter placement="right-end" />
          </div>
        </Tooltip>

        <Tooltip content={t("nav.settings", "Ajustes")} placement="right" delay={150} closeDelay={0}>
          <Button
            isIconOnly
            variant="light"
            radius="full"
            size="sm"
            className="h-9 w-9 min-w-0 text-default-400 hover:text-foreground hover:bg-default-100/50 transition-colors cursor-pointer"
            aria-label={t("nav.settings", "Ajustes")}
            onPress={() => void openOrFocusSettingsWindow()}>
            <Settings size={19} />
          </Button>
        </Tooltip>

        <Tooltip
          content={isDark ? t("common.theme.light", "Modo Claro") : t("common.theme.dark", "Modo Oscuro")}
          placement="right"
          delay={150}
          closeDelay={0}>
          <Button
            isIconOnly
            variant="light"
            radius="full"
            size="sm"
            className="h-9 w-9 min-w-0 text-default-400 hover:text-foreground hover:bg-default-100/50 transition-colors cursor-pointer"
            aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
            onPress={() => setTheme(isDark ? "light" : "dark")}>
            {isDark ? <Sun size={19} /> : <Moon size={19} />}
          </Button>
        </Tooltip>
      </div>
    </aside>
  );
}
