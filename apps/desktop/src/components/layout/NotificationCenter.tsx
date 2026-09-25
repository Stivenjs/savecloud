import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Popover,
  PopoverContent,
  type PopoverProps,
  PopoverTrigger,
  ScrollShadow,
  Spinner,
  Switch,
  Tooltip,
} from "@heroui/react";
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCheck,
  Cloud,
  Download,
  ExternalLink,
  FolderOpen,
  Info,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useNotificationsQuery,
  useUnreadCountQuery,
  useNotificationActions,
} from "@hooks/queries/useNotificationsQueries";
import type { NotificationRecord } from "@services/tauri/notifications.service";
import { formatShortRelativeDate } from "@utils/format";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { formatGameDisplayName, detectGameFromText } from "@utils/gameImage";
import { useConfig } from "@hooks/useConfig";
import { PlayingGameThumbnail } from "@features/games/PlayingGameThumbnail";
import { openOrFocusSettingsWindow } from "@/windows/settingsWindow";

/** Toma el directorio de destino de payloadJson si kind es una descarga terminal, sino null */
function getDownloadDir(n: NotificationRecord): string | null {
  if (n.kind !== "source_download_terminal") return null;
  if (n.severity !== "success") return null;
  try {
    const payload = JSON.parse(n.payloadJson ?? "{}");
    return typeof payload.destinationDir === "string" ? payload.destinationDir : null;
  } catch {
    return null;
  }
}

/** Abre el directorio en el sistema de archivos */
async function openFolder(dir: string) {
  try {
    await openPath(dir);
  } catch (err) {
    console.error("Could not open folder:", err);
  }
}

/** Toma la URI de destino del payloadJson si la descarga de fuentes falló, sino null */
function getDownloadUri(n: NotificationRecord): string | null {
  if (n.kind !== "source_download_terminal") return null;
  if (n.severity !== "error") return null;
  try {
    const payload = JSON.parse(n.payloadJson ?? "{}");
    return typeof payload.selectedUri === "string" ? payload.selectedUri : null;
  } catch {
    return null;
  }
}

/** Abre la URL en el navegador externo */
async function openLink(url: string) {
  try {
    await openUrl(url);
  } catch (err) {
    console.error("Could not open URL:", err);
  }
}

/** Determina si una notificación es de tipo logro */
function isAchievementNotification(n: NotificationRecord): boolean {
  return (
    n.kind === "achievement" || n.title.toLowerCase().includes("logro") || n.title.toLowerCase().includes("achievement")
  );
}

/** Determina si una notificación califica como Hero / Banner destacado estilo Xbox */
function isHeroNotification(n: NotificationRecord): boolean {
  return (
    n.kind === "system" ||
    n.kind === "partner" ||
    n.kind === "cloud_alert" ||
    n.severity === "warning" ||
    n.title.toLowerCase().includes("partner") ||
    n.title.toLowerCase().includes("extensión") ||
    n.title.toLowerCase().includes("extension") ||
    n.title.toLowerCase().includes("importante") ||
    n.title.toLowerCase().includes("aviso")
  );
}

/** Fila de notificación estilo Xbox adaptada a SaveCloud */
function NotificationRow({
  n,
  onRead,
  onDismiss,
}: {
  n: NotificationRecord;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { config } = useConfig();
  const unread = !n.readAt || !n.readAt.trim();
  const downloadDir = getDownloadDir(n);
  const downloadUri = getDownloadUri(n);
  const isAchievement = isAchievementNotification(n);

  const detectedGameId = useMemo(
    () => detectGameFromText({ gameId: n.gameId, title: n.title, body: n.body, games: config?.games }),
    [n.gameId, n.body, n.title, config?.games]
  );

  let displayBody = n.body;
  if (n.gameId) {
    const formatted = formatGameDisplayName(n.gameId);
    const escaped = n.gameId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?<![a-zA-Z0-9_-])${escaped}(?![a-zA-Z0-9_-])`, "g");
    displayBody = n.body.replace(regex, formatted);
  }

  return (
    <div
      onClick={() => {
        if (unread) onRead(n.id);
      }}
      className={`group relative flex items-start gap-3 p-3 rounded-xl transition-all duration-150 cursor-pointer ${
        unread
          ? "bg-primary/5 hover:bg-primary/10 dark:bg-primary/10 dark:hover:bg-primary/15 border border-primary/15"
          : "hover:bg-default-100/70 border border-transparent"
      }`}>
      {/* Icono / Carátula de juego */}
      <div className="relative shrink-0 mt-0.5">
        {detectedGameId ? (
          <PlayingGameThumbnail
            gameId={detectedGameId}
            size="md"
            className="h-11 w-11 rounded-lg object-cover shadow-xs bg-default-100 border border-default-200/60 dark:border-default-100/20 shrink-0"
          />
        ) : isAchievement ? (
          <div className="w-11 h-11 rounded-lg bg-warning-500/15 text-warning-500 border border-warning-500/25 flex items-center justify-center shadow-xs shrink-0">
            <Trophy size={20} />
          </div>
        ) : n.kind === "source_download_terminal" || n.kind === "torrent_done" ? (
          <div className="w-11 h-11 rounded-lg bg-primary-500/15 text-primary-500 border border-primary-500/25 flex items-center justify-center shadow-xs shrink-0">
            <Download size={20} />
          </div>
        ) : n.severity === "error" ? (
          <div className="w-11 h-11 rounded-lg bg-danger-500/15 text-danger-500 border border-danger-500/25 flex items-center justify-center shadow-xs shrink-0">
            <AlertTriangle size={20} />
          </div>
        ) : n.severity === "warning" ? (
          <div className="w-11 h-11 rounded-lg bg-warning-500/15 text-warning-500 border border-warning-500/25 flex items-center justify-center shadow-xs shrink-0">
            <AlertTriangle size={20} />
          </div>
        ) : n.severity === "success" ? (
          <div className="w-11 h-11 rounded-lg bg-success-500/15 text-success-500 border border-success-500/25 flex items-center justify-center shadow-xs shrink-0">
            <Cloud size={20} />
          </div>
        ) : (
          <div className="w-11 h-11 rounded-lg bg-default-500/15 text-default-500 border border-default-200/50 dark:border-default-100/20 flex items-center justify-center shadow-xs shrink-0">
            <Bell size={20} />
          </div>
        )}
      </div>

      {/* Contenido principal */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <p
              className={`font-semibold text-[13.5px] leading-tight truncate ${
                unread ? "text-foreground font-bold" : "text-default-700 dark:text-default-300"
              }`}>
              {n.title}
            </p>
            {unread && (
              <span
                className="size-2 rounded-full bg-primary shrink-0 shadow-xs"
                title={t("notifications.markRead", "No leída")}
              />
            )}
          </div>
          {/* Timestamp estilo Xbox a la derecha */}
          <span className="text-[11px] text-default-400 font-normal shrink-0 ml-auto whitespace-nowrap">
            {formatShortRelativeDate(n.createdAt)}
          </span>
        </div>

        {/* Descripción de la notificación */}
        <p className="mt-0.5 text-xs text-default-500 dark:text-default-400 leading-snug line-clamp-2 select-text">
          {displayBody}
        </p>

        {/* Barra de acciones en hover */}
        <div className="mt-1.5 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto">
          {downloadDir && (
            <Tooltip content={t("notifications.openFolder", "Abrir carpeta")} delay={200}>
              <Button
                size="sm"
                isIconOnly
                variant="flat"
                className="h-6.5 w-6.5 min-w-0 bg-default-200/70 hover:bg-default-300 text-default-700 dark:text-default-200 rounded-lg"
                onPress={() => void openFolder(downloadDir)}>
                <FolderOpen size={13} />
              </Button>
            </Tooltip>
          )}

          {downloadUri && (
            <Tooltip content={t("notifications.openUrl", "Abrir enlace")} delay={200}>
              <Button
                size="sm"
                isIconOnly
                variant="flat"
                className="h-6.5 w-6.5 min-w-0 bg-default-200/70 hover:bg-default-300 text-default-700 dark:text-default-200 rounded-lg"
                onPress={() => void openLink(downloadUri)}>
                <ExternalLink size={13} />
              </Button>
            </Tooltip>
          )}

          {unread && (
            <Tooltip content={t("notifications.markRead", "Marcar como leída")} delay={200}>
              <Button
                size="sm"
                isIconOnly
                variant="flat"
                className="h-6.5 w-6.5 min-w-0 bg-primary/20 hover:bg-primary text-primary hover:text-white rounded-lg"
                onPress={() => onRead(n.id)}>
                <Check size={13} />
              </Button>
            </Tooltip>
          )}

          <Tooltip content={t("notifications.dismiss", "Descartar")} delay={200}>
            <Button
              size="sm"
              isIconOnly
              variant="flat"
              className="h-6.5 w-6.5 min-w-0 bg-default-200/70 hover:bg-danger/20 text-default-400 hover:text-danger rounded-lg"
              onPress={() => onDismiss(n.id)}>
              <X size={13} />
            </Button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

/** Tarjeta destacada (Hero Card estilo Xbox adaptada a SaveCloud) */
function FeaturedNotificationCard({
  n,
  onRead,
  onDismiss,
}: {
  n: NotificationRecord;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const { t } = useTranslation();
  const downloadDir = getDownloadDir(n);
  const downloadUri = getDownloadUri(n);

  return (
    <div className="bg-default-100/70 dark:bg-default-100/30 border border-default-200/60 dark:border-default-100/20 rounded-xl p-3.5 space-y-3 shadow-xs mx-4 mb-2.5">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0 mt-0.5">
          <Info size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold text-foreground leading-tight">{n.title}</h3>
            <span className="text-[11px] text-default-400 font-normal shrink-0">
              {formatShortRelativeDate(n.createdAt)}
            </span>
          </div>
          <p className="text-xs text-default-500 dark:text-default-400 leading-relaxed mt-1">{n.body}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        {downloadDir ? (
          <Button
            size="sm"
            color="primary"
            variant="solid"
            className="font-semibold text-xs px-3.5 rounded-xl h-8 shadow-xs"
            startContent={<FolderOpen size={14} />}
            onPress={() => {
              void openFolder(downloadDir);
              onRead(n.id);
            }}>
            {t("notifications.openFolder", "Abrir carpeta")}
          </Button>
        ) : downloadUri ? (
          <Button
            size="sm"
            color="primary"
            variant="solid"
            className="font-semibold text-xs px-3.5 rounded-xl h-8 shadow-xs"
            startContent={<ExternalLink size={14} />}
            onPress={() => {
              void openLink(downloadUri);
              onRead(n.id);
            }}>
            {t("notifications.openUrl", "Abrir enlace")}
          </Button>
        ) : (
          <Button
            size="sm"
            color="primary"
            variant="solid"
            className="font-semibold text-xs px-3.5 rounded-xl h-8 shadow-xs"
            onPress={() => {
              void openOrFocusSettingsWindow();
              onRead(n.id);
            }}>
            {t("notifications.goToSettings", "Ir a Configuración")}
          </Button>
        )}

        <Button
          size="sm"
          variant="flat"
          color="default"
          className="text-xs px-3.5 rounded-xl h-8"
          onPress={() => onDismiss(n.id)}>
          {t("notifications.later", "Lo haré más tarde")}
        </Button>
      </div>
    </div>
  );
}

/** Centro de notificaciones estilo Xbox adaptado a SaveCloud */
export function NotificationCenter({ placement = "right-start" }: { placement?: PopoverProps["placement"] } = {}) {
  const { t } = useTranslation();
  const { data: items = [], isLoading: loading } = useNotificationsQuery();
  const { data: unreadCount = 0 } = useUnreadCountQuery();
  const { markRead, markAllRead, dismiss, dismissAll, syncWithCloud } = useNotificationActions();

  const [open, setOpen] = useState(false);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) {
        setIsMenuOpen(false);
      }
      if (next) {
        void syncWithCloud();
      }
    },
    [syncWithCloud]
  );

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handleClickOutside);
    return () => {
      document.removeEventListener("pointerdown", handleClickOutside);
    };
  }, [isMenuOpen]);

  const filteredItems: NotificationRecord[] = useMemo(() => {
    if (!showUnreadOnly) return items;
    return items.filter((n: NotificationRecord) => !n.readAt || !n.readAt.trim());
  }, [items, showUnreadOnly]);

  const featuredNotification: NotificationRecord | null = useMemo(() => {
    return (
      filteredItems.find((n: NotificationRecord) => (!n.readAt || !n.readAt.trim()) && isHeroNotification(n)) ?? null
    );
  }, [filteredItems]);

  const regularItems: NotificationRecord[] = useMemo(() => {
    if (!featuredNotification) return filteredItems;
    return filteredItems.filter((n: NotificationRecord) => n.id !== featuredNotification.id);
  }, [filteredItems, featuredNotification]);

  return (
    <Popover placement={placement} showArrow={false} isOpen={open} onOpenChange={onOpenChange} offset={14}>
      {/* Disparador estilo Xbox */}
      <PopoverTrigger>
        <Button
          isIconOnly
          radius="full"
          variant="light"
          size="sm"
          className="h-9 w-9 min-w-0 text-foreground hover:bg-default-100/50 bg-transparent border-transparent shadow-none"
          aria-label={t("notifications.center", "Centro de notificaciones")}>
          <Badge
            content={unreadCount > 0 ? (unreadCount > 9 ? "9+" : unreadCount) : undefined}
            color="danger"
            size="sm"
            shape="circle"
            isInvisible={unreadCount === 0}
            classNames={{
              badge: "text-[10px] font-bold h-4 min-w-4 right-[2px] top-[2px]",
            }}>
            <Bell size={18} />
          </Badge>
        </Button>
      </PopoverTrigger>

      {/* Ventana Popover alargada estilo Xbox App con diseño SaveCloud */}
      <PopoverContent className="w-[calc(100vw-5rem)] sm:w-97.5 md:w-102.5 max-w-105 h-[min(82vh,740px)] min-h-125 flex flex-col rounded-2xl p-0 shadow-2xl overflow-visible border border-default-200/60 dark:border-default-100/20 bg-content1 text-foreground">
        {/* Encabezado superior */}
        <div className="flex w-full items-center justify-between px-4 py-3.5 border-b border-default-200/50 dark:border-default-100/10 bg-default-50/60 dark:bg-default-50/20 shrink-0 relative">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold text-foreground tracking-tight">
              {t("notifications.title", "Notificaciones")}
            </h2>
            {unreadCount > 0 && (
              <span className="inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold h-4 min-w-4 px-1.5 shadow-xs">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Menú de opciones (...) */}
            <div className="relative" ref={menuRef}>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                className={`h-7.5 w-7.5 min-w-0 rounded-lg text-default-500 hover:text-foreground transition-colors ${
                  isMenuOpen ? "bg-default-200/70 text-foreground" : "hover:bg-default-100"
                }`}
                aria-label={t("notifications.options", "Opciones")}
                onPress={() => setIsMenuOpen((prev) => !prev)}>
                <MoreHorizontal size={16} />
              </Button>

              {/* Dropdown flotante inline */}
              {isMenuOpen && (
                <div className="absolute right-0 top-9 z-50 w-56 rounded-xl border border-default-200/60 dark:border-default-100/20 bg-content1 p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100">
                  <button
                    disabled={unreadCount === 0}
                    onClick={() => {
                      setIsMenuOpen(false);
                      void markAllRead();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg text-left text-foreground hover:bg-default-100 disabled:opacity-40 disabled:hover:bg-transparent transition-colors cursor-pointer disabled:cursor-not-allowed">
                    <CheckCheck size={14} className="text-primary shrink-0" />
                    <span className="font-medium">{t("notifications.markAllRead", "Marcar todas como leídas")}</span>
                  </button>

                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      void syncWithCloud();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg text-left text-foreground hover:bg-default-100 transition-colors cursor-pointer">
                    <RefreshCw size={14} className="text-primary shrink-0" />
                    <span className="font-medium">{t("notifications.syncNow", "Sincronizar con la nube")}</span>
                  </button>

                  <div className="h-px bg-default-200/60 dark:bg-default-100/10 my-1" />

                  <button
                    disabled={items.length === 0}
                    onClick={() => {
                      setIsMenuOpen(false);
                      void dismissAll();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg text-left text-danger hover:bg-danger/10 disabled:opacity-40 disabled:hover:bg-transparent transition-colors cursor-pointer disabled:cursor-not-allowed">
                    <Trash2 size={14} className="shrink-0" />
                    <span className="font-medium">{t("notifications.clearAll", "Eliminar todas")}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Botón cerrar (✕) */}
            <Button
              isIconOnly
              size="sm"
              variant="light"
              className="h-7.5 w-7.5 min-w-0 rounded-lg text-default-500 hover:text-foreground hover:bg-default-100"
              aria-label={t("notifications.close", "Cerrar")}
              onPress={() => setOpen(false)}>
              <X size={16} />
            </Button>
          </div>
        </div>

        {/* Barra cápsula con switch: "Mostrar solo los no leídos" */}
        <div className="w-full px-4 pt-3 pb-2 shrink-0">
          <div className="bg-default-100/70 dark:bg-default-100/30 border border-default-200/50 dark:border-default-100/20 rounded-xl px-3.5 py-2.5 flex items-center justify-between shadow-xs">
            <span className="text-xs sm:text-[13px] font-medium text-foreground/90">
              {t("notifications.showUnreadOnly", "Mostrar solo los no leídos")}
            </span>
            <Switch
              size="sm"
              color="primary"
              isSelected={showUnreadOnly}
              onValueChange={setShowUnreadOnly}
              aria-label={t("notifications.showUnreadOnly", "Mostrar solo los no leídos")}
            />
          </div>
        </div>

        {/* Tarjeta destacada (Hero Card si existe) */}
        {featuredNotification && (
          <div className="shrink-0">
            <FeaturedNotificationCard
              n={featuredNotification}
              onRead={(id) => void markRead(id)}
              onDismiss={(id) => void dismiss(id)}
            />
          </div>
        )}

        {/* Lista alargada de notificaciones con ScrollShadow flexible */}
        <ScrollShadow className="flex-1 min-h-0 w-full px-3 pb-3">
          {loading ? (
            <div className="flex justify-center py-16">
              <Spinner size="md" color="primary" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2.5 py-16 text-center px-4">
              {showUnreadOnly ? (
                <>
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-1">
                    <CheckCheck size={24} strokeWidth={1.5} />
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    {t("notifications.allCaughtUp", "Estás al día")}
                  </p>
                  <p className="text-xs text-default-400 max-w-60">
                    {t("notifications.noUnread", "No tienes notificaciones sin leer.")}
                  </p>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-2xl bg-default-100 border border-default-200/60 dark:border-default-100/20 flex items-center justify-center text-default-400 mb-1">
                    <Bell size={24} strokeWidth={1.5} />
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    {t("notifications.empty", "Sin notificaciones pendientes")}
                  </p>
                  <p className="text-xs text-default-400 max-w-60">
                    {t("notifications.emptyDesc", "Te avisaremos cuando haya actividad o sincronizaciones.")}
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col space-y-1">
              {regularItems.map((n: NotificationRecord) => (
                <NotificationRow
                  key={n.id}
                  n={n}
                  onRead={(id) => void markRead(id)}
                  onDismiss={(id) => void dismiss(id)}
                />
              ))}
            </div>
          )}
        </ScrollShadow>
      </PopoverContent>
    </Popover>
  );
}
