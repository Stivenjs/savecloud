import { useCallback, useMemo, useState } from "react";
import { Badge, Button, Popover, PopoverContent, PopoverTrigger, ScrollShadow, Spinner } from "@heroui/react";
import { AlertTriangle, Bell, CheckCheck, Download, ExternalLink, FolderOpen, Info, Trash2, X } from "lucide-react";
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
import { formatGameDisplayName } from "@utils/gameImage";
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
  if (kind === "source_download_terminal") return <Download size={size} />;
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

const iconBgMap: Record<string, string> = {
  success: "bg-emerald-500/12 text-emerald-500",
  warning: "bg-amber-500/12 text-amber-500",
  danger: "bg-rose-500/12 text-rose-500",
  primary: "bg-blue-500/12 text-blue-500",
  default: "bg-default-500/12 text-default-400",
};

const textColorMap: Record<string, string> = {
  success: "text-emerald-500 dark:text-emerald-400",
  warning: "text-amber-500 dark:text-amber-400",
  danger: "text-rose-500 dark:text-rose-400",
  primary: "text-blue-500 dark:text-blue-400",
  default: "text-default-400",
};

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
  const iconBg = iconBgMap[color] ?? iconBgMap.default;
  const iconText = textColorMap[color] ?? textColorMap.default;
  const downloadDir = getDownloadDir(n);
  const downloadUri = getDownloadUri(n);

  const detectedGameId = useMemo(() => {
    if (n.gameId?.trim()) return n.gameId.trim();

    if (config?.games?.length) {
      const bodyLower = n.body.toLowerCase();
      const titleLower = n.title.toLowerCase();
      for (const g of config.games) {
        const dName = formatGameDisplayName(g.id).toLowerCase();
        const gId = g.id.toLowerCase();
        const normId = gId.replace(/[-_ ]/g, "");
        const normName = dName.replace(/[-_ ]/g, "");

        if (
          bodyLower.includes(dName) ||
          bodyLower.includes(gId) ||
          titleLower.includes(dName) ||
          titleLower.includes(gId) ||
          (normId.length >= 4 && bodyLower.replace(/[-_ ]/g, "").includes(normId)) ||
          (normName.length >= 4 && bodyLower.replace(/[-_ ]/g, "").includes(normName))
        ) {
          return g.id;
        }
      }
    }

    const colonMatch = n.body.match(/^([^:]{3,40}):/);
    if (colonMatch) {
      return colonMatch[1].trim();
    }
    const forMatch = n.body.match(/para\s+([^.]{3,40})\.?$/i);
    if (forMatch) {
      return forMatch[1].trim();
    }

    return null;
  }, [n.gameId, n.body, n.title, config?.games]);

  let displayBody = n.body;
  if (n.gameId) {
    const formatted = formatGameDisplayName(n.gameId);
    const escaped = n.gameId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?<![a-zA-Z0-9_-])${escaped}(?![a-zA-Z0-9_-])`, "g");
    displayBody = n.body.replace(regex, formatted);
  }

  return (
    <div className="group relative flex items-start gap-3 p-2.5 text-sm transition-all duration-200 hover:bg-default-100/50 dark:hover:bg-white/5 rounded-xl">
      {/* Icono / Carátula limpia del juego */}
      <div className="relative shrink-0 mt-0.5">
        {detectedGameId ? (
          <PlayingGameThumbnail
            gameId={detectedGameId}
            size="md"
            className="h-11 w-18 rounded-lg shadow-xs object-cover"
          />
        ) : (
          <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${iconBg} shadow-xs`}>
            <SeverityIcon color={color} kind={n.kind} size={16} />
          </div>
        )}
      </div>

      {/* Contenido */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {detectedGameId && (
              <span className={`shrink-0 ${iconText}`}>
                <SeverityIcon color={color} kind={n.kind} size={14} />
              </span>
            )}
            <p
              className={`font-medium leading-snug text-sm truncate ${unread ? "text-foreground font-semibold" : "text-default-700"}`}>
              {n.title}
            </p>
            {unread && <span className="size-1.5 rounded-full bg-primary shrink-0" />}
          </div>
          {/* Botón de descarte — visible al pasar el mouse */}
          <button
            onClick={() => onDismiss(n.id)}
            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-default-400 hover:text-danger-400 mt-0.5"
            aria-label={t("notifications.dismiss")}>
            <X size={14} />
          </button>
        </div>

        <p className="mt-1 text-xs text-default-500 leading-relaxed">{displayBody}</p>

        {/* Fila de acciones */}
        <div className="mt-2.5 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-default-400">{formatRelativeDate(n.createdAt)}</span>

          <div className="flex gap-1.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto">
            {/* Botón de apertura de carpeta — solo para descargas completadas */}
            {downloadDir && (
              <Button
                size="sm"
                variant="flat"
                color="primary"
                className="h-6 px-2 text-[11px] gap-1 min-w-0"
                startContent={<FolderOpen size={12} />}
                onPress={() => void openFolder(downloadDir)}>
                {t("notifications.openFolder")}
              </Button>
            )}

            {/* Botón de apertura de URL — para descargas fallidas */}
            {downloadUri && (
              <Button
                size="sm"
                variant="flat"
                color="warning"
                className="h-6 px-2 text-[11px] gap-1 min-w-0"
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
                className="h-6 px-2 text-[11px] min-w-0"
                onPress={() => onRead(n.id)}>
                {t("notifications.markRead")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
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
    <Popover placement="bottom-end" showArrow isOpen={open} onOpenChange={onOpenChange}>
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
      <PopoverContent className="w-[min(100vw-1.5rem,460px)] rounded-2xl p-0 shadow-2xl overflow-hidden border border-default-200/50 dark:border-default-100/20">
        {/* Encabezado */}
        <div className="flex w-full items-center justify-between gap-2 px-4 py-3 border-b border-default-100 bg-default-50/80 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <Bell size={15} className="text-default-500" />
            <span className="text-sm font-semibold tracking-tight">{t("notifications.title")}</span>
            {unreadCount > 0 && (
              <span className="inline-flex items-center justify-center rounded-full bg-primary-500 text-white text-[10px] font-bold h-4 min-w-4 px-1">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </div>

          <div className="flex gap-1">
            <Button
              size="sm"
              variant="flat"
              isDisabled={unreadCount === 0}
              color="success"
              className="h-7 px-2 text-xs gap-1"
              startContent={<CheckCheck size={13} />}
              onPress={() => void markAllRead()}>
              {t("notifications.markAllRead")}
            </Button>
            <Button
              size="sm"
              variant="flat"
              isDisabled={items.length === 0}
              color="danger"
              className="h-7 px-2 text-xs gap-1"
              startContent={<Trash2 size={13} />}
              onPress={() => void dismissAll()}>
              {t("notifications.clearAll")}
            </Button>
          </div>
        </div>

        {/* Cuerpo */}
        <ScrollShadow className="max-h-[min(70vh,460px)]">
          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner size="md" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-14 text-default-400">
              <Bell size={32} strokeWidth={1.2} />
              <p className="text-sm">{t("notifications.empty")}</p>
            </div>
          ) : (
            <div className="p-2.5 flex flex-col gap-1.5">
              {groups.map((g) => (
                <div key={g.key} className="space-y-1">
                  {/* Etiqueta de día */}
                  <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold text-default-400 uppercase tracking-wider">
                    {g.label}
                  </div>

                  {/* Filas */}
                  <div className="flex flex-col gap-1.5">
                    {g.items.map((n) => (
                      <NotificationRow
                        key={n.id}
                        n={n}
                        onRead={(id) => void markRead(id)}
                        onDismiss={(id) => void dismiss(id)}
                      />
                    ))}
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
