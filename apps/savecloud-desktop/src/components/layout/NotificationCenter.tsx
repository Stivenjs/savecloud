import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Popover, PopoverContent, PopoverTrigger, ScrollShadow, Spinner } from "@heroui/react";
import { AlertTriangle, Bell, CheckCheck, Info, Trash2 } from "lucide-react";
import { useNotificationStore } from "@store/NotificationStore";
import type { NotificationRecord } from "@services/tauri/notifications.service";
import { formatRelativeDate } from "@utils/format";
import { formatDayGroupHeading, getLocalDayKey } from "@utils/operationHistory";

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

function NotificationRow({
  n,
  onRead,
  onDismiss,
}: {
  n: NotificationRecord;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const unread = !n.readAt || !n.readAt.trim();
  const color = severityColor(n.severity);

  const icon = (() => {
    switch (color) {
      case "success":
        return <CheckCheck size={16} />;
      case "warning":
      case "danger":
        return <AlertTriangle size={16} />;
      default:
        return <Info size={16} />;
    }
  })();

  const iconBg =
    color === "success"
      ? "bg-success-500/10 text-success-600"
      : color === "warning"
        ? "bg-warning-500/10 text-warning-600"
        : color === "danger"
          ? "bg-danger-500/10 text-danger-600"
          : "bg-primary-500/10 text-primary-600";

  return (
    <div className="group flex gap-3 px-3 py-3 text-sm transition-colors hover:bg-content1/40 border-b border-default-200/60">
      <div className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${iconBg}`}>{icon}</div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${unread ? "bg-primary-500" : "bg-default-300"}`}
                aria-hidden="true"
              />
              <p className="font-medium leading-tight">{n.title}</p>
            </div>
            <p className="mt-1 text-xs text-default-500">{formatRelativeDate(n.createdAt)}</p>
          </div>
        </div>

        <p className="mt-2 text-default-700">{n.body}</p>

        <div className="mt-2 flex flex-wrap gap-2 opacity-0 transition-opacity duration-150 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto">
          {unread && (
            <Button size="sm" variant="flat" onPress={() => onRead(n.id)} color="success">
              Marcar leída
            </Button>
          )}
          <Button
            size="sm"
            variant="light"
            color="danger"
            startContent={<Trash2 size={14} />}
            onPress={() => onDismiss(n.id)}>
            Descartar
          </Button>
        </div>
      </div>
    </div>
  );
}

export function NotificationCenter() {
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const items = useNotificationStore((s) => s.items);
  const loading = useNotificationStore((s) => s.loading);
  const refreshUnreadCount = useNotificationStore((s) => s.refreshUnreadCount);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const markRead = useNotificationStore((s) => s.markRead);
  const dismiss = useNotificationStore((s) => s.dismiss);
  const syncWithCloud = useNotificationStore((s) => s.syncWithCloud);

  const [open, setOpen] = useState(false);

  useEffect(() => {
    void refreshUnreadCount();
  }, [refreshUnreadCount]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        void syncWithCloud();
      }
    },
    [syncWithCloud]
  );

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
    if (map.has("unknown")) keys.push("unknown");

    return keys.map((key) => ({
      key,
      label: formatDayGroupHeading(key),
      items: map.get(key) ?? [],
    }));
  })();

  return (
    <Popover placement="bottom-end" showArrow isOpen={open} onOpenChange={onOpenChange}>
      <PopoverTrigger>
        <Button
          isIconOnly
          radius="sm"
          variant="light"
          className="bg-transparent border-transparent shadow-none"
          aria-label="Centro de notificaciones">
          <Badge
            content={unreadCount > 0 ? (unreadCount > 9 ? "9+" : unreadCount) : undefined}
            color="danger"
            size="sm"
            shape="circle"
            isInvisible={unreadCount === 0}>
            <Bell size={22} />
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(100vw-2rem,420px)] rounded-xl p-0 shadow-lg">
        <div className="flex w-full items-center justify-between gap-2 border-b border-default-200 bg-default-50 px-4 py-3">
          <span className="text-sm font-semibold">Notificaciones</span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="flat"
              isDisabled={unreadCount === 0}
              color="success"
              startContent={<CheckCheck size={16} />}
              onPress={() => void markAllRead()}>
              Todas leídas
            </Button>
          </div>
        </div>
        <ScrollShadow className="max-h-[min(70vh,420px)] px-3 py-1">
          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner size="lg" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-default-500">No hay notificaciones.</p>
          ) : (
            <div className="flex flex-col gap-2 pb-2">
              {groups.map((g) => (
                <div key={g.key} className="flex flex-col gap-2">
                  <div className="px-2 pt-2 text-xs font-semibold text-default-500">{g.label}</div>
                  {g.items.map((n) => (
                    <NotificationRow
                      key={n.id}
                      n={n}
                      onRead={(id) => void markRead(id)}
                      onDismiss={(id) => void dismiss(id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </ScrollShadow>
      </PopoverContent>
    </Popover>
  );
}
