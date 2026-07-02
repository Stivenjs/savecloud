import { useCallback, useState } from "react";
import { Badge, Button, Popover, PopoverContent, PopoverTrigger, ScrollShadow, Spinner } from "@heroui/react";
import { AlertTriangle, Bell, CheckCheck, Download, FolderOpen, Info, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useNotificationsQuery,
  useUnreadCountQuery,
  useNotificationActions,
} from "@hooks/queries/useNotificationsQueries";
import type { NotificationRecord } from "@services/tauri/notifications.service";
import { formatRelativeDate } from "@utils/format";
import { formatDayGroupHeading, getLocalDayKey } from "@utils/operationHistory";
import { openPath } from "@tauri-apps/plugin-opener";
import { formatGameDisplayName } from "@utils/gameImage";

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

function SeverityIcon({ color, kind }: { color: string; kind: string }) {
  if (kind === "source_download_terminal") return <Download size={15} />;
  switch (color) {
    case "success":
      return <CheckCheck size={15} />;
    case "warning":
    case "danger":
      return <AlertTriangle size={15} />;
    default:
      return <Info size={15} />;
  }
}

const iconBgMap: Record<string, string> = {
  success: "bg-emerald-500/12 text-emerald-500",
  warning: "bg-amber-500/12 text-amber-500",
  danger: "bg-rose-500/12 text-rose-500",
  primary: "bg-blue-500/12 text-blue-500",
  default: "bg-default-500/12 text-default-400",
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
  const unread = !n.readAt || !n.readAt.trim();
  const color = severityColor(n.severity);
  const iconBg = iconBgMap[color] ?? iconBgMap.default;
  const downloadDir = getDownloadDir(n);

  let displayBody = n.body;
  if (n.gameId) {
    const formatted = formatGameDisplayName(n.gameId);
    const escaped = n.gameId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?<![a-zA-Z0-9_-])${escaped}(?![a-zA-Z0-9_-])`, "g");
    displayBody = n.body.replace(regex, formatted);
  }

  return (
    <div
      className={`
        group relative flex gap-3 px-4 py-3 text-sm transition-all duration-200
        hover:bg-default-100/60 rounded-xl
        ${unread ? "bg-primary-50/30 dark:bg-primary-900/10" : ""}
      `}>
      {/* Barra de resaltado para notificaciones no leídas */}
      {unread && <span className="absolute left-0 top-3 bottom-3 w-0.75 rounded-full bg-primary-400" />}

      {/* Icono */}
      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
        <SeverityIcon color={color} kind={n.kind} />
      </div>

      {/* Contenido */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={`font-medium leading-snug text-sm ${unread ? "text-foreground" : "text-default-700"}`}>
            {n.title}
          </p>
          {/* Botón de descarte — visible al pasar el mouse */}
          <button
            onClick={() => onDismiss(n.id)}
            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-default-400 hover:text-danger-400 mt-0.5"
            aria-label={t("notifications.dismiss")}>
            <X size={14} />
          </button>
        </div>

        <p className="mt-0.5 text-xs text-default-500 leading-relaxed">{displayBody}</p>

        {/* Fila de acciones */}
        <div className="mt-2 flex items-center gap-2 flex-wrap">
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
          radius="sm"
          variant="light"
          className="bg-transparent border-transparent shadow-none"
          aria-label={t("notifications.center")}>
          <Badge
            content={unreadCount > 0 ? (unreadCount > 9 ? "9+" : unreadCount) : undefined}
            color="danger"
            size="sm"
            shape="circle"
            isInvisible={unreadCount === 0}>
            <Bell size={20} />
          </Badge>
        </Button>
      </PopoverTrigger>

      {/* Contenido */}
      <PopoverContent className="w-[min(100vw-1rem,400px)] rounded-2xl p-0 shadow-xl overflow-hidden ">
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
        <ScrollShadow className="max-h-[min(70vh,440px)]">
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
            <div className="px-2 py-2 flex flex-col gap-1">
              {groups.map((g) => (
                <div key={g.key}>
                  {/* Etiqueta de día */}
                  <div className="px-2 pt-2 pb-1 text-[11px] font-semibold text-default-400 uppercase tracking-wider">
                    {g.label}
                  </div>

                  {/* Filas */}
                  <div className="flex flex-col gap-0.5">
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
