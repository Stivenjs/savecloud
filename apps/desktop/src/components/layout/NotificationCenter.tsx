import { useCallback, useMemo, useState } from "react";
import { Badge, Button, Popover, PopoverContent, PopoverTrigger, ScrollShadow, Spinner } from "@heroui/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  Clock,
  Download,
  ExternalLink,
  FolderOpen,
  Info,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useNotificationsQuery,
  useUnreadCountQuery,
  useNotificationActions,
} from "@hooks/queries/useNotificationsQueries";
import type { NotificationRecord } from "@services/tauri/notifications.service";
import { formatRelativeDate } from "@utils/format";
import { formatDayGroupHeading, getLocalDayKey } from "@utils/operationHistory";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { formatGameDisplayName, detectGameFromText } from "@utils/gameImage";
import { useConfig } from "@hooks/useConfig";
import { PlayingGameThumbnail } from "@features/games/PlayingGameThumbnail";

function severityColor(severity: string): "default" | "primary" | "success" | "warning" | "danger" {
  switch (severity) {
    case "success":
      return "success";
    case "error":
      return "danger";
    case "warning":
      return "warning";
    default:
      return "primary";
  }
}

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

function SeverityIcon({ color, kind, size = 15 }: { color: string; kind: string; size?: number }) {
  if (kind === "source_download_terminal" || kind === "torrent_done") return <Download size={size} />;
  switch (color) {
    case "success":
      return <CheckCheck size={size} />;
    case "warning":
    case "danger":
      return <AlertTriangle size={size} />;
    default:
      return <Info size={size} />;
  }
}

const severityTheme: Record<
  string,
  {
    badgeBg: string;
    iconBg: string;
    text: string;
    border: string;
  }
> = {
  success: {
    badgeBg: "bg-emerald-500 text-white shadow-emerald-500/20",
    iconBg: "bg-emerald-500/12 text-emerald-500 dark:bg-emerald-500/20 dark:text-emerald-400",
    text: "text-emerald-600 dark:text-emerald-400",
    border: "border-emerald-500/30 dark:border-emerald-500/20",
  },
  danger: {
    badgeBg: "bg-rose-500 text-white shadow-rose-500/20",
    iconBg: "bg-rose-500/12 text-rose-500 dark:bg-rose-500/20 dark:text-rose-400",
    text: "text-rose-600 dark:text-rose-400",
    border: "border-rose-500/30 dark:border-rose-500/20",
  },
  warning: {
    badgeBg: "bg-amber-500 text-white shadow-amber-500/20",
    iconBg: "bg-amber-500/12 text-amber-500 dark:bg-amber-500/20 dark:text-amber-400",
    text: "text-amber-600 dark:text-amber-400",
    border: "border-amber-500/30 dark:border-amber-500/20",
  },
  primary: {
    badgeBg: "bg-blue-500 text-white shadow-blue-500/20",
    iconBg: "bg-blue-500/12 text-blue-500 dark:bg-blue-500/20 dark:text-blue-400",
    text: "text-blue-600 dark:text-blue-400",
    border: "border-blue-500/30 dark:border-blue-500/20",
  },
  default: {
    badgeBg: "bg-default-500 text-white shadow-default-500/20",
    iconBg: "bg-default-100 text-default-500 dark:bg-white/10 dark:text-default-400",
    text: "text-default-500",
    border: "border-default-200/50 dark:border-white/10",
  },
};

/** Renderiza el texto del cuerpo con detección inteligente de rutas o datos técnicos */
function FormattedNotificationBody({ body, gameId }: { body: string; gameId?: string | null }) {
  let displayBody = body;
  if (gameId) {
    const formatted = formatGameDisplayName(gameId);
    const escaped = gameId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?<![a-zA-Z0-9_-])${escaped}(?![a-zA-Z0-9_-])`, "g");
    displayBody = displayBody.replace(regex, formatted);
  }

  const pathRegex = /([a-zA-Z]:\\[^\s"']+|\/(?:[^\s"']+\/)+[^\s"']+)/g;

  if (!pathRegex.test(displayBody)) {
    return (
      <p className="mt-1 text-xs text-default-600 dark:text-zinc-300/90 leading-relaxed wrap-break-word select-text">
        {displayBody}
      </p>
    );
  }

  const parts: (string | { isPath: boolean; text: string })[] = [];
  let lastIndex = 0;
  pathRegex.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pathRegex.exec(displayBody)) !== null) {
    if (match.index > lastIndex) {
      parts.push(displayBody.substring(lastIndex, match.index));
    }
    parts.push({ isPath: true, text: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < displayBody.length) {
    parts.push(displayBody.substring(lastIndex));
  }

  return (
    <p className="mt-1 text-xs text-default-600 dark:text-zinc-300/90 leading-relaxed wrap-break-word select-text">
      {parts.map((p, idx) => {
        if (typeof p === "string") return <span key={idx}>{p}</span>;
        return (
          <code
            key={idx}
            className="inline-block my-0.5 px-1.5 py-0.5 text-[11px] font-mono bg-default-200/60 dark:bg-white/10 text-foreground rounded border border-default-300/40 dark:border-white/10 break-all select-all font-medium">
            {p.text}
          </code>
        );
      })}
    </p>
  );
}

/** Fila de notificación */
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
  const color = severityColor(n.severity);
  const theme = severityTheme[color] ?? severityTheme.default;
  const downloadDir = getDownloadDir(n);
  const downloadUri = getDownloadUri(n);

  const detectedGameId = useMemo(
    () => detectGameFromText({ gameId: n.gameId, title: n.title, body: n.body, games: config?.games }),
    [n.gameId, n.body, n.title, config?.games]
  );

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, height: 0, marginTop: 0, marginBottom: 0, padding: 0, overflow: "hidden" }}
      transition={{ duration: 0.2 }}
      className={`group relative flex items-start gap-2.5 sm:gap-3 p-2.5 sm:p-3 text-sm transition-all duration-200 rounded-xl border ${
        unread
          ? "bg-default-50/90 hover:bg-default-100/80 dark:bg-zinc-800/40 dark:hover:bg-zinc-800/70 border-primary-500/25 shadow-xs"
          : "bg-transparent hover:bg-default-100/50 dark:hover:bg-white/4 border-default-100/70 dark:border-white/5 opacity-85 hover:opacity-100"
      }`}>
      {/* Icono / Carátula limpia del juego con badge de severidad */}
      <div className="relative shrink-0 select-none">
        {detectedGameId ? (
          <div className="relative">
            <PlayingGameThumbnail
              gameId={detectedGameId}
              size="md"
              className="h-10 w-15 sm:h-11 sm:w-16 rounded-lg ring-1 ring-black/10 dark:ring-white/10 shadow-xs object-cover"
            />
            {/* Badge de severidad superpuesto sobre la carátula */}
            <div
              className={`absolute -bottom-1 -right-1 size-4.5 rounded-full flex items-center justify-center ${theme.badgeBg} ring-2 ring-background shadow-xs`}>
              <SeverityIcon color={color} kind={n.kind} size={10} />
            </div>
          </div>
        ) : (
          <div
            className={`flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-xl ${theme.iconBg} border border-default-200/40 dark:border-white/10 shadow-xs`}>
            <SeverityIcon color={color} kind={n.kind} size={18} />
          </div>
        )}
      </div>

      {/* Contenido */}
      <div className="min-w-0 flex-1 flex flex-col justify-between">
        <div className="flex items-start justify-between gap-1.5 min-w-0">
          <div className="min-w-0 flex-1 flex items-center gap-1.5">
            {unread && (
              <span className="size-2 rounded-full bg-primary shrink-0 shadow-xs animate-pulse" title="No leída" />
            )}
            <h4
              className={`font-semibold text-xs sm:text-sm leading-snug wrap-break-word ${
                unread ? "text-foreground" : "text-default-700 dark:text-zinc-200"
              }`}>
              {n.title}
            </h4>
          </div>

          {/* Botón de descarte (X) */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(n.id);
            }}
            className="shrink-0 p-1 -mr-1 -mt-0.5 rounded-lg text-default-400 hover:text-danger-500 hover:bg-danger-500/10 active:scale-95 transition-all opacity-70 hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
            title={t("notifications.dismiss")}
            aria-label={t("notifications.dismiss")}>
            <X size={14} />
          </button>
        </div>

        {/* Cuerpo formateado */}
        <FormattedNotificationBody body={n.body} gameId={n.gameId} />

        {/* Fila de acciones y fecha */}
        <div className="mt-2.5 pt-1.5 flex flex-wrap items-center justify-between gap-1.5 border-t border-default-100/50 dark:border-white/5">
          <div className="flex items-center gap-1 text-[11px] text-default-400 shrink-0 font-medium">
            <Clock size={11} className="opacity-70" />
            <span>{formatRelativeDate(n.createdAt)}</span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap ml-auto">
            {downloadDir && (
              <Button
                size="sm"
                variant="flat"
                color="primary"
                className="h-6 px-2 text-[11px] font-medium gap-1 min-w-0 rounded-md"
                startContent={<FolderOpen size={12} />}
                onPress={() => void openFolder(downloadDir)}>
                {t("notifications.openFolder")}
              </Button>
            )}

            {downloadUri && (
              <Button
                size="sm"
                variant="flat"
                color="warning"
                className="h-6 px-2 text-[11px] font-medium gap-1 min-w-0 rounded-md"
                startContent={<ExternalLink size={12} />}
                onPress={() => void openLink(downloadUri)}>
                {t("notifications.openUrl")}
              </Button>
            )}

            {unread && (
              <Button
                size="sm"
                variant="flat"
                color="success"
                className="h-6 px-2 text-[11px] font-medium min-w-0 gap-1 rounded-md hover:bg-emerald-500/20"
                startContent={<CheckCheck size={12} />}
                onPress={() => onRead(n.id)}>
                {t("notifications.markRead")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** Centro de notificaciones */
export function NotificationCenter() {
  const { t } = useTranslation();
  const { data: items = [], isLoading: loading } = useNotificationsQuery();
  const { data: unreadCount = 0 } = useUnreadCountQuery();
  const { markRead, markAllRead, dismiss, dismissAll, syncWithCloud } = useNotificationActions();

  const [open, setOpen] = useState(false);

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) void syncWithCloud();
    },
    [syncWithCloud]
  );

  // Agrupar por día
  const groups = (() => {
    if (!items.length) return [];
    const map = new Map<string, NotificationRecord[]>();
    for (const it of items) {
      const key = getLocalDayKey(it.createdAt);
      const list = map.get(key);
      if (list) list.push(it);
      else map.set(key, [it]);
    }
    const keys = [...map.keys()].sort((a, b) => b.localeCompare(a));
    if (map.has("unknown")) {
      const idx = keys.indexOf("unknown");
      if (idx !== -1) keys.splice(idx, 1);
      keys.push("unknown");
    }
    return keys.map((key) => ({
      key,
      label: formatDayGroupHeading(key),
      items: map.get(key) ?? [],
    }));
  })();

  return (
    <Popover placement="bottom-end" offset={10} showArrow isOpen={open} onOpenChange={onOpenChange}>
      {/* Disparador */}
      <PopoverTrigger>
        <Button
          isIconOnly
          radius="full"
          variant="light"
          size="sm"
          className="h-9 w-9 min-w-0 text-foreground hover:bg-default-100/50 bg-transparent border-transparent shadow-none"
          aria-label={t("notifications.center")}>
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

      {/* Contenido */}
      <PopoverContent className="w-[calc(100vw-1.5rem)] sm:w-115 md:w-120 max-w-120 rounded-2xl p-0 shadow-2xl overflow-hidden border border-default-200/60 dark:border-default-100/20 bg-background/95 backdrop-blur-xl">
        {/* Encabezado */}
        <div className="flex w-full items-center justify-between gap-2 px-3.5 py-3 border-b border-default-100/80 dark:border-white/5 bg-default-50/80 dark:bg-zinc-900/60 backdrop-blur-md">
          <div className="flex items-center gap-2 min-w-0">
            <div className="size-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Bell size={15} />
            </div>
            <span className="text-sm font-semibold tracking-tight truncate">{t("notifications.title")}</span>
            {unreadCount > 0 && (
              <span className="inline-flex items-center justify-center rounded-full bg-primary-500 text-white text-[10px] font-bold h-4.5 min-w-4.5 px-1.5 shadow-xs">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              size="sm"
              variant="flat"
              isDisabled={unreadCount === 0}
              color="success"
              className="h-7 px-2 text-xs gap-1 font-medium rounded-lg"
              startContent={<CheckCheck size={13} />}
              onPress={() => void markAllRead()}>
              <span className="hidden xs:inline sm:inline">{t("notifications.markAllRead")}</span>
            </Button>
            <Button
              size="sm"
              variant="flat"
              isDisabled={items.length === 0}
              color="danger"
              className="h-7 px-2 text-xs gap-1 font-medium rounded-lg"
              startContent={<Trash2 size={13} />}
              onPress={() => void dismissAll()}>
              <span className="hidden xs:inline sm:inline">{t("notifications.clearAll")}</span>
            </Button>
          </div>
        </div>

        {/* Cuerpo */}
        <ScrollShadow className="max-h-[min(72vh,520px)] overflow-y-auto px-2 py-2 sm:px-3 sm:py-2.5">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-14">
              <Spinner size="md" color="primary" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2.5 py-14 text-center px-4">
              <div className="size-12 rounded-2xl bg-default-100/60 dark:bg-white/5 flex items-center justify-center text-default-400 mb-1">
                <Bell size={24} strokeWidth={1.5} />
              </div>
              <p className="text-sm font-medium text-default-600 dark:text-zinc-300">{t("notifications.empty")}</p>
              <p className="text-xs text-default-400 max-w-60">
                Te avisaremos cuando haya nuevas descargas, sincronizaciones o actividades.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {groups.map((g) => (
                <div key={g.key} className="space-y-1.5">
                  {/* Etiqueta de día */}
                  <div className="sticky top-0 z-10 backdrop-blur-md bg-background/90 dark:bg-zinc-900/90 py-1 px-2 text-[10.5px] font-bold text-default-400 uppercase tracking-wider rounded-md border-b border-default-100/40 dark:border-white/5 flex items-center justify-between">
                    <span>{g.label}</span>
                    <span className="text-[10px] font-medium opacity-60">
                      {g.items.length} {g.items.length === 1 ? "notificación" : "notificaciones"}
                    </span>
                  </div>

                  {/* Filas con animación */}
                  <div className="flex flex-col gap-1.5">
                    <AnimatePresence initial={false}>
                      {g.items.map((n) => (
                        <NotificationRow
                          key={n.id}
                          n={n}
                          onRead={(id) => void markRead(id)}
                          onDismiss={(id) => void dismiss(id)}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollShadow>
      </PopoverContent>
    </Popover>
  );
}
